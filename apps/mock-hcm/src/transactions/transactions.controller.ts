import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { HcmStore } from '../common/hcm-store';
import { FailureModeService } from '../common/failure-mode.service';
import { SubmitTransactionDto } from './dto';

@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly store: HcmStore,
    private readonly failure: FailureModeService,
  ) {}

  @Post()
  async submit(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: SubmitTransactionDto,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header required');
    }

    await this.maybeDelay();

    const mode = this.failure.getMode();

    if (mode === 'DOWN') {
      throw new HttpException('HCM unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }

    if (mode === 'FLAKY' && this.failure.shouldFlakyFail(idempotencyKey)) {
      throw new HttpException('HCM transient error', HttpStatus.BAD_GATEWAY);
    }

    if (mode === 'REJECT_ALL') {
      throw new UnprocessableEntityException({
        code: 'HCM_REJECTED',
        message: 'Rejected by HCM (test mode)',
      });
    }

    const existing = this.store.findTransactionByIdempotencyKey(idempotencyKey);
    if (existing) {
      // Compare critical fields — reject conflicting reuse of same key.
      if (
        existing.employeeId !== body.employeeId ||
        existing.locationId !== body.locationId ||
        existing.days !== body.days ||
        existing.type !== body.type
      ) {
        throw new HttpException(
          { code: 'IDEMPOTENCY_CONFLICT', message: 'Same key, different payload' },
          HttpStatus.CONFLICT,
        );
      }
      return existing;
    }

    if (mode === 'INSUFFICIENT_BALANCE') {
      throw new UnprocessableEntityException({
        code: 'INSUFFICIENT_BALANCE',
        message: 'Insufficient balance (test mode)',
      });
    }

    const balance = this.store.getBalance(body.employeeId, body.locationId);
    if (!balance) {
      throw new UnprocessableEntityException({
        code: 'UNKNOWN_LOCATION',
        message: `No balance for ${body.employeeId}/${body.locationId}`,
      });
    }

    if (mode !== 'SILENT_ACCEPT') {
      // Real validation
      if (body.type === 'DEBIT' && balance.balanceDays < body.days) {
        throw new UnprocessableEntityException({
          code: 'INSUFFICIENT_BALANCE',
          message: `Have ${balance.balanceDays}, need ${body.days}`,
        });
      }
      const newBalance =
        body.type === 'DEBIT'
          ? balance.balanceDays - body.days
          : balance.balanceDays + body.days;
      this.store.upsertBalance({
        ...balance,
        balanceDays: newBalance,
        hcmUpdatedAt: new Date().toISOString(),
      });
    }
    // SILENT_ACCEPT: pretend it worked but DON'T mutate the balance — this is the
    // "HCM may silently accept" failure mode the brief warns about.

    const tx = this.store.recordTransaction({
      transactionId: uuid(),
      idempotencyKey,
      employeeId: body.employeeId,
      locationId: body.locationId,
      days: body.days,
      type: body.type,
      reason: body.reason,
      recordedAt: new Date().toISOString(),
    });
    return tx;
  }

  @Get()
  list() {
    return { transactions: this.store.listTransactions() };
  }

  private async maybeDelay(): Promise<void> {
    const ms = this.failure.getLatencyMs();
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }
}
