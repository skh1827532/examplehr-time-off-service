import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Balance } from '../balances/balance.entity';
import { BalancesService } from '../balances/balances.service';
import { TimeOffRequestsService } from '../time-off-requests/time-off-requests.service';
import { SyncLogService } from './sync-log.service';
import { HcmBalanceUpdateDto, HcmBatchSyncDto } from './dto';

export interface BatchSyncReport {
  generatedAt: string;
  applied: number;
  drift: number;
  created: number;
  staled: number;
  revokedRequests: string[];
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @InjectRepository(Balance) private readonly balanceRepo: Repository<Balance>,
    private readonly balances: BalancesService,
    private readonly requests: TimeOffRequestsService,
    private readonly syncLog: SyncLogService,
  ) {}

  async applyWebhook(input: HcmBalanceUpdateDto): Promise<{
    balance: Balance;
    revokedRequests: string[];
    drift: boolean;
  }> {
    const before = await this.balances.findOne(input.employeeId, input.locationId);
    const beforeDays = before?.balanceDays;
    const balance = await this.balances.applyHcmBalance({
      employeeId: input.employeeId,
      locationId: input.locationId,
      balanceDays: input.balanceDays,
      hcmUpdatedAt: input.hcmUpdatedAt,
    });
    const drift = before != null && beforeDays !== input.balanceDays;
    await this.syncLog.log({
      direction: 'INBOUND',
      kind: 'WEBHOOK',
      employeeId: input.employeeId,
      locationId: input.locationId,
      payload: input as unknown as Record<string, unknown>,
      result: drift ? 'DRIFT' : 'OK',
      detail: drift
        ? `local=${beforeDays} → hcm=${input.balanceDays}${input.source ? ` (${input.source})` : ''}`
        : `applied (${input.balanceDays})${input.source ? ` (${input.source})` : ''}`,
    });
    const { revoked } = await this.requests.revalidateAfterBalanceChange(
      input.employeeId,
      input.locationId,
    );
    return { balance, revokedRequests: revoked, drift };
  }

  async applyBatch(batch: HcmBatchSyncDto): Promise<BatchSyncReport> {
    const report: BatchSyncReport = {
      generatedAt: batch.generatedAt,
      applied: 0,
      drift: 0,
      created: 0,
      staled: 0,
      revokedRequests: [],
    };

    const seenKeys = new Set<string>();

    for (const row of batch.balances) {
      const key = `${row.employeeId}::${row.locationId}`;
      seenKeys.add(key);
      const before = await this.balances.findOne(row.employeeId, row.locationId);
      const beforeDays = before?.balanceDays;
      await this.balances.applyHcmBalance({
        employeeId: row.employeeId,
        locationId: row.locationId,
        balanceDays: row.balanceDays,
        hcmUpdatedAt: row.hcmUpdatedAt,
      });

      let result: 'OK' | 'DRIFT' | 'CREATED' = 'OK';
      if (!before) {
        result = 'CREATED';
        report.created += 1;
      } else if (beforeDays !== row.balanceDays) {
        result = 'DRIFT';
        report.drift += 1;
      }
      report.applied += 1;

      await this.syncLog.log({
        direction: 'INBOUND',
        kind: 'BATCH',
        employeeId: row.employeeId,
        locationId: row.locationId,
        payload: row as unknown as Record<string, unknown>,
        result,
        detail:
          result === 'DRIFT'
            ? `local=${beforeDays} → hcm=${row.balanceDays}`
            : result === 'CREATED'
              ? `created (${row.balanceDays})`
              : `unchanged (${row.balanceDays})`,
      });

      if (before && beforeDays !== row.balanceDays) {
        const { revoked } = await this.requests.revalidateAfterBalanceChange(
          row.employeeId,
          row.locationId,
        );
        report.revokedRequests.push(...revoked);
      }
    }

    // Mark balances missing from HCM as STALE so they block new requests.
    const allLocal = await this.balanceRepo.find({ where: { status: Not('STALE' as never) } });
    for (const local of allLocal) {
      const key = `${local.employeeId}::${local.locationId}`;
      if (!seenKeys.has(key)) {
        local.status = 'STALE';
        await this.balanceRepo.save(local);
        report.staled += 1;
        await this.syncLog.log({
          direction: 'INBOUND',
          kind: 'BATCH',
          employeeId: local.employeeId,
          locationId: local.locationId,
          payload: null,
          result: 'STALE',
          detail: 'absent from HCM batch — marked STALE',
        });
      }
    }

    return report;
  }
}
