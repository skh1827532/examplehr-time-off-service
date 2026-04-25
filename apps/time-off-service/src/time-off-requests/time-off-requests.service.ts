import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { v4 as uuid } from 'uuid';
import {
  TERMINAL_STATUSES,
  TimeOffRequest,
  TimeOffRequestStatus,
} from './time-off-request.entity';
import { Balance } from '../balances/balance.entity';
import { BalancesService } from '../balances/balances.service';
import { LocationsService } from '../locations/locations.service';
import { OutboxService } from '../outbox/outbox.service';
import { DomainErrors } from '../common/domain-errors';
import { isValidRange, rangesOverlap } from './date-utils';
import { nextStatus } from './state-machine';
import {
  ApproveTimeOffRequestDto,
  CancelTimeOffRequestDto,
  CreateTimeOffRequestDto,
  ListTimeOffRequestsQueryDto,
  RejectTimeOffRequestDto,
} from './dto';

const ACTIVE_STATUSES: TimeOffRequestStatus[] = [
  'PENDING_APPROVAL',
  'APPROVED',
  'HCM_CONFIRMED',
];

@Injectable()
export class TimeOffRequestsService {
  private readonly logger = new Logger(TimeOffRequestsService.name);

  constructor(
    @InjectRepository(TimeOffRequest)
    private readonly repo: Repository<TimeOffRequest>,
    private readonly dataSource: DataSource,
    private readonly balances: BalancesService,
    private readonly locations: LocationsService,
    private readonly outbox: OutboxService,
  ) {}

  async create(dto: CreateTimeOffRequestDto): Promise<TimeOffRequest> {
    if (!isValidRange(dto.startDate, dto.endDate)) {
      throw DomainErrors.invalidDateRange('startDate must be on or before endDate');
    }
    if (dto.days <= 0) {
      throw DomainErrors.invalidDateRange('days must be > 0');
    }

    await this.locations.findOrFail(dto.locationId);

    const balance = await this.balances.getOrFail(dto.employeeId, dto.locationId);
    if (balance.status === 'STALE') {
      throw DomainErrors.balanceStaleBlocked(dto.employeeId, dto.locationId);
    }

    // Sum the days already committed (PENDING/APPROVED/CONFIRMED) — those represent
    // future debits. The balance row is already net of HCM-confirmed debits (HCM
    // updates it via webhook/batch), so we subtract only PENDING + APPROVED here.
    const inflight = await this.sumInflightDays(dto.employeeId, dto.locationId);
    const projected = balance.balanceDays - inflight;
    if (projected < dto.days) {
      throw DomainErrors.insufficientBalance(projected, dto.days);
    }

    const overlap = await this.findOverlapping(
      dto.employeeId,
      dto.startDate,
      dto.endDate,
    );
    if (overlap) {
      throw DomainErrors.overlappingRequest(overlap.id);
    }

    const req = this.repo.create({
      id: uuid(),
      employeeId: dto.employeeId,
      locationId: dto.locationId,
      startDate: dto.startDate,
      endDate: dto.endDate,
      days: dto.days,
      reason: dto.reason ?? null,
      status: 'PENDING_APPROVAL',
      balanceDecremented: false,
    });
    return this.repo.save(req);
  }

  async findOne(id: string): Promise<TimeOffRequest> {
    const req = await this.repo.findOne({ where: { id } });
    if (!req) throw DomainErrors.notFound(`time-off request ${id}`);
    return req;
  }

  async list(q: ListTimeOffRequestsQueryDto): Promise<TimeOffRequest[]> {
    const where: Record<string, unknown> = {};
    if (q.employeeId) where.employeeId = q.employeeId;
    if (q.locationId) where.locationId = q.locationId;
    if (q.status) where.status = q.status;
    return this.repo.find({ where, order: { createdAt: 'DESC' } });
  }

  /**
   * Manager approval. Atomically:
   *  1. transition state PENDING_APPROVAL → APPROVED
   *  2. decrement local balance
   *  3. write outbox event for HCM submission
   * All in one DB transaction.
   */
  async approve(id: string, dto: ApproveTimeOffRequestDto): Promise<TimeOffRequest> {
    return this.dataSource.transaction(async (em) => {
      const repo = em.getRepository(TimeOffRequest);
      const req = await repo.findOne({ where: { id } });
      if (!req) throw DomainErrors.notFound(`time-off request ${id}`);

      const newStatus = nextStatus(req.status, 'APPROVE');

      // Re-check balance under transaction.
      const balance = await em.getRepository(Balance).findOne({
        where: { employeeId: req.employeeId, locationId: req.locationId },
      });
      if (!balance) throw DomainErrors.notFound(`balance ${req.employeeId}/${req.locationId}`);
      if (balance.status === 'STALE') {
        throw DomainErrors.balanceStaleBlocked(req.employeeId, req.locationId);
      }
      // Decrement (this throws INSUFFICIENT_BALANCE if balance < days).
      await this.balances.decrement(req.employeeId, req.locationId, req.days, em);

      req.status = newStatus;
      req.decidedBy = dto.managerId;
      req.decidedAt = new Date();
      req.balanceDecremented = true;
      await repo.save(req);

      // Outbox the HCM submit in same transaction.
      await this.outbox.enqueueInTransaction(em, {
        aggregateType: 'TimeOffRequest',
        aggregateId: req.id,
        eventType: 'HCM_SUBMIT_DEBIT',
        idempotencyKey: `${req.id}:submit`,
        payload: {
          employeeId: req.employeeId,
          locationId: req.locationId,
          days: req.days,
          type: 'DEBIT',
          reason: req.reason ?? `time-off ${req.startDate}..${req.endDate}`,
        },
      });

      return req;
    });
  }

  async reject(id: string, dto: RejectTimeOffRequestDto): Promise<TimeOffRequest> {
    const req = await this.findOne(id);
    req.status = nextStatus(req.status, 'REJECT');
    req.decidedBy = dto.managerId;
    req.decidedAt = new Date();
    req.rejectionReason = dto.reason;
    return this.repo.save(req);
  }

  async cancel(id: string, dto: CancelTimeOffRequestDto): Promise<TimeOffRequest> {
    return this.dataSource.transaction(async (em) => {
      const repo = em.getRepository(TimeOffRequest);
      const req = await repo.findOne({ where: { id } });
      if (!req) throw DomainErrors.notFound(`time-off request ${id}`);

      const previousStatus = req.status;
      req.status = nextStatus(req.status, 'CANCEL');
      req.decidedBy = dto.actorId;
      req.decidedAt = new Date();
      req.rejectionReason = dto.reason ?? null;

      if (req.balanceDecremented) {
        await this.balances.increment(req.employeeId, req.locationId, req.days, em);
        req.balanceDecremented = false;
      }

      await repo.save(req);

      // If we'd already pushed to HCM (or it might be in flight), outbox a refund.
      if (previousStatus === 'HCM_CONFIRMED' || previousStatus === 'APPROVED') {
        await this.outbox.enqueueInTransaction(em, {
          aggregateType: 'TimeOffRequest',
          aggregateId: req.id,
          eventType: 'HCM_SUBMIT_CREDIT',
          idempotencyKey: `${req.id}:refund`,
          payload: {
            employeeId: req.employeeId,
            locationId: req.locationId,
            days: req.days,
            type: 'CREDIT',
            reason: `cancellation refund for ${req.id}`,
          },
        });
      }

      return req;
    });
  }

  /** Called by outbox worker on success. */
  async markHcmConfirmed(id: string, hcmTransactionId: string): Promise<void> {
    const req = await this.findOne(id);
    if (req.status === 'HCM_CONFIRMED') return; // idempotent
    if (req.status !== 'APPROVED') {
      this.logger.warn(`HCM_CONFIRM ignored: ${id} is in ${req.status}`);
      return;
    }
    req.status = nextStatus(req.status, 'HCM_CONFIRM');
    req.hcmTransactionId = hcmTransactionId;
    req.hcmConfirmedAt = new Date();
    await this.repo.save(req);
  }

  /** Called by outbox worker on permanent HCM rejection. */
  async markHcmRejected(id: string, reason: string): Promise<void> {
    return this.dataSource.transaction(async (em) => {
      const repo = em.getRepository(TimeOffRequest);
      const req = await repo.findOne({ where: { id } });
      if (!req) return;
      if (TERMINAL_STATUSES.has(req.status)) return;
      req.status = nextStatus(req.status, 'HCM_REJECT');
      req.rejectionReason = reason;
      if (req.balanceDecremented) {
        await this.balances.increment(req.employeeId, req.locationId, req.days, em);
        req.balanceDecremented = false;
      }
      await repo.save(req);
    });
  }

  /**
   * Re-validate all non-terminal requests for (employee, location) after the
   * balance changed (HCM webhook or batch). Auto-revokes any whose projected
   * balance went negative.
   */
  async revalidateAfterBalanceChange(
    employeeId: string,
    locationId: string,
  ): Promise<{ revoked: string[] }> {
    const revoked: string[] = [];
    const balance = await this.balances.findOne(employeeId, locationId);
    if (!balance) return { revoked };

    const active = await this.repo.find({
      where: {
        employeeId,
        locationId,
        status: In(['PENDING_APPROVAL']),
      },
      order: { createdAt: 'ASC' },
    });

    let remaining = balance.balanceDays;
    for (const r of active) {
      if (remaining < r.days) {
        await this.dataSource.transaction(async (em) => {
          const repo = em.getRepository(TimeOffRequest);
          const fresh = await repo.findOne({ where: { id: r.id } });
          if (!fresh || fresh.status !== 'PENDING_APPROVAL') return;
          fresh.status = nextStatus(fresh.status, 'BALANCE_REVOKED');
          fresh.rejectionReason = 'balance_revoked';
          fresh.decidedAt = new Date();
          await repo.save(fresh);
        });
        revoked.push(r.id);
      } else {
        remaining -= r.days;
      }
    }
    return { revoked };
  }

  private async sumInflightDays(employeeId: string, locationId: string): Promise<number> {
    const rows = await this.repo.find({
      where: {
        employeeId,
        locationId,
        status: In(['PENDING_APPROVAL', 'APPROVED']),
      },
    });
    return rows.reduce((s, r) => s + Number(r.days), 0);
  }

  private async findOverlapping(
    employeeId: string,
    startDate: string,
    endDate: string,
  ): Promise<TimeOffRequest | null> {
    const candidates = await this.repo.find({
      where: { employeeId, status: In(ACTIVE_STATUSES) },
    });
    return (
      candidates.find((c) => rangesOverlap(c.startDate, c.endDate, startDate, endDate)) ??
      null
    );
  }
}
