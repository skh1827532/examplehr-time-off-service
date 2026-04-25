import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { HcmClient } from '../hcm/hcm.client';
import { OutboxEvent } from './outbox-event.entity';
import { computeBackoffMs } from './backoff';
import { TimeOffRequestsService } from '../time-off-requests/time-off-requests.service';
import { SyncLogService } from '../sync/sync-log.service';

@Injectable()
export class OutboxWorker implements OnModuleInit {
  private readonly logger = new Logger(OutboxWorker.name);
  private interval?: NodeJS.Timeout;
  private running = false;
  private autoStart = true;
  private maxAttempts = Number(process.env.OUTBOX_MAX_ATTEMPTS ?? 8);
  private intervalMs = Number(process.env.OUTBOX_WORKER_INTERVAL_MS ?? 2000);

  constructor(
    private readonly outbox: OutboxService,
    private readonly hcm: HcmClient,
    private readonly requests: TimeOffRequestsService,
    private readonly syncLog: SyncLogService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || process.env.OUTBOX_AUTO_START === 'false') {
      this.autoStart = false;
      return;
    }
    this.start();
  }

  start(intervalMs?: number): void {
    if (this.interval) return;
    if (intervalMs) this.intervalMs = intervalMs;
    this.interval = setInterval(() => this.tick().catch(() => undefined), this.intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  /** Drain the outbox now. Used by tests for deterministic flushing. */
  async drain(maxRounds = 5): Promise<{ processed: number }> {
    let total = 0;
    for (let i = 0; i < maxRounds; i++) {
      const n = await this.tick();
      total += n;
      if (n === 0) break;
    }
    return { processed: total };
  }

  private async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const batch = await this.outbox.claimBatch(20);
      let processed = 0;
      for (const ev of batch) {
        await this.processOne(ev);
        processed += 1;
      }
      return processed;
    } finally {
      this.running = false;
    }
  }

  private async processOne(ev: OutboxEvent): Promise<void> {
    await this.outbox.markInFlight(ev);
    const payload = ev.payload as {
      employeeId: string;
      locationId: string;
      days: number;
      type: 'DEBIT' | 'CREDIT';
      reason?: string;
    };

    const result = await this.hcm.submitTransaction({
      idempotencyKey: ev.idempotencyKey,
      employeeId: payload.employeeId,
      locationId: payload.locationId,
      days: payload.days,
      type: payload.type,
      reason: payload.reason,
    });

    if (result.status === 'OK') {
      await this.outbox.markSent(ev);
      await this.syncLog.log({
        direction: 'OUTBOUND',
        kind: 'SUBMIT',
        employeeId: payload.employeeId,
        locationId: payload.locationId,
        payload: { ...payload, transactionId: result.transaction.transactionId },
        result: 'OK',
        detail: `tx ${result.transaction.transactionId}`,
      });
      if (ev.eventType === 'HCM_SUBMIT_DEBIT' && ev.aggregateType === 'TimeOffRequest') {
        await this.requests.markHcmConfirmed(ev.aggregateId, result.transaction.transactionId);
      }
      return;
    }

    if (result.status === 'REJECTED') {
      await this.outbox.markPermanentlyFailed(ev, `${result.code}: ${result.message}`);
      await this.syncLog.log({
        direction: 'OUTBOUND',
        kind: 'SUBMIT',
        employeeId: payload.employeeId,
        locationId: payload.locationId,
        payload,
        result: 'ERROR',
        detail: `${result.code}: ${result.message}`,
      });
      if (ev.eventType === 'HCM_SUBMIT_DEBIT' && ev.aggregateType === 'TimeOffRequest') {
        await this.requests.markHcmRejected(ev.aggregateId, `${result.code}: ${result.message}`);
      }
      // For CREDIT (refund) rejections we leave it as permanently failed and let ops handle it.
      return;
    }

    // UNAVAILABLE — retry with backoff or give up.
    if (ev.attempts + 1 >= this.maxAttempts) {
      await this.outbox.markPermanentlyFailed(ev, `Exhausted after ${ev.attempts + 1} attempts: ${result.cause}`);
      await this.syncLog.log({
        direction: 'OUTBOUND',
        kind: 'SUBMIT',
        employeeId: payload.employeeId,
        locationId: payload.locationId,
        payload,
        result: 'ERROR',
        detail: `unavailable, exhausted: ${result.cause}`,
      });
      return;
    }
    const next = new Date(Date.now() + computeBackoffMs(ev.attempts + 1));
    await this.outbox.markFailedRetry(ev, next, result.cause);
  }

  /** Test-only: tick once now. */
  async tickOnce(): Promise<number> {
    return this.tick();
  }
}
