import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { HcmStore } from '../common/hcm-store';
import { FailureModeService } from '../common/failure-mode.service';

@Controller()
export class BalancesController {
  constructor(
    private readonly store: HcmStore,
    private readonly failure: FailureModeService,
  ) {}

  @Get('balances')
  async list(
    @Query('employeeId') employeeId?: string,
    @Query('locationId') locationId?: string,
  ) {
    await this.maybeDelay();
    if (this.failure.getMode() === 'DOWN') {
      throw new HttpException('HCM unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }
    let balances = this.store.listBalances();
    if (employeeId) balances = balances.filter((b) => b.employeeId === employeeId);
    if (locationId) balances = balances.filter((b) => b.locationId === locationId);
    return { balances };
  }

  @Get('balances/:employeeId/:locationId')
  async getOne(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
  ) {
    await this.maybeDelay();
    if (this.failure.getMode() === 'DOWN') {
      throw new HttpException('HCM unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }
    const b = this.store.getBalance(employeeId, locationId);
    if (!b) throw new NotFoundException(`No balance for ${employeeId}/${locationId}`);
    return b;
  }

  @Get('batch/balances')
  async batch() {
    await this.maybeDelay();
    if (this.failure.getMode() === 'DOWN') {
      throw new HttpException('HCM unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return {
      generatedAt: new Date().toISOString(),
      balances: this.store.listBalances(),
    };
  }

  private async maybeDelay(): Promise<void> {
    const ms = this.failure.getLatencyMs();
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }
}
