import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { HcmSyncLog, SyncDirection, SyncKind, SyncResult } from './hcm-sync-log.entity';

interface LogInput {
  direction: SyncDirection;
  kind: SyncKind;
  employeeId?: string | null;
  locationId?: string | null;
  payload?: Record<string, unknown> | null;
  result: SyncResult;
  detail?: string | null;
}

@Injectable()
export class SyncLogService {
  constructor(
    @InjectRepository(HcmSyncLog) private readonly repo: Repository<HcmSyncLog>,
  ) {}

  log(input: LogInput): Promise<HcmSyncLog> {
    return this.repo.save(
      this.repo.create({
        direction: input.direction,
        kind: input.kind,
        employeeId: input.employeeId ?? null,
        locationId: input.locationId ?? null,
        payload: input.payload ?? null,
        result: input.result,
        detail: input.detail ?? null,
      }),
    );
  }

  list(opts: { since?: Date; kind?: SyncKind; result?: SyncResult }): Promise<HcmSyncLog[]> {
    const where: Record<string, unknown> = {};
    if (opts.kind) where.kind = opts.kind;
    if (opts.result) where.result = opts.result;
    if (opts.since) where.createdAt = LessThan(opts.since); // simple
    return this.repo.find({ where, order: { createdAt: 'DESC' }, take: 200 });
  }
}
