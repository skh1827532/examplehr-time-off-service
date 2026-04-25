import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { v4 as uuid } from 'uuid';
import { OutboxEvent, OutboxEventType } from './outbox-event.entity';

interface EnqueueInput {
  aggregateType: string;
  aggregateId: string;
  eventType: OutboxEventType;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class OutboxService {
  constructor(
    @InjectRepository(OutboxEvent)
    private readonly repo: Repository<OutboxEvent>,
  ) {}

  async enqueueInTransaction(
    em: EntityManager,
    input: EnqueueInput,
  ): Promise<OutboxEvent> {
    const repo = em.getRepository(OutboxEvent);
    const ev = repo.create({
      id: uuid(),
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: new Date(),
    });
    return repo.save(ev);
  }

  /** Claim a batch of events ready to send. */
  async claimBatch(limit = 10): Promise<OutboxEvent[]> {
    const now = new Date();
    return this.repo.find({
      where: [
        { status: 'PENDING', nextAttemptAt: LessThanOrEqual(now) },
        { status: 'PENDING', nextAttemptAt: IsNull() },
        { status: 'FAILED', nextAttemptAt: LessThanOrEqual(now) },
      ],
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  async markInFlight(ev: OutboxEvent): Promise<OutboxEvent> {
    ev.status = 'IN_FLIGHT';
    return this.repo.save(ev);
  }

  async markSent(ev: OutboxEvent): Promise<OutboxEvent> {
    ev.status = 'SENT';
    ev.lastError = null;
    return this.repo.save(ev);
  }

  async markFailedRetry(
    ev: OutboxEvent,
    nextAttemptAt: Date,
    error: string,
  ): Promise<OutboxEvent> {
    ev.status = 'FAILED';
    ev.attempts += 1;
    ev.nextAttemptAt = nextAttemptAt;
    ev.lastError = error;
    return this.repo.save(ev);
  }

  async markPermanentlyFailed(ev: OutboxEvent, error: string): Promise<OutboxEvent> {
    ev.status = 'FAILED_PERMANENT';
    ev.attempts += 1;
    ev.lastError = error;
    return this.repo.save(ev);
  }

  findById(id: string): Promise<OutboxEvent | null> {
    return this.repo.findOne({ where: { id } });
  }

  list(status?: string): Promise<OutboxEvent[]> {
    if (status) {
      return this.repo.find({ where: { status: status as never }, order: { createdAt: 'DESC' } });
    }
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async forceReplay(id: string): Promise<OutboxEvent | null> {
    const ev = await this.repo.findOne({ where: { id } });
    if (!ev) return null;
    ev.status = 'PENDING';
    ev.nextAttemptAt = new Date();
    return this.repo.save(ev);
  }
}
