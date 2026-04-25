import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Balance } from './balance.entity';
import { HcmClient } from '../hcm/hcm.client';
import { DomainErrors } from '../common/domain-errors';

@Injectable()
export class BalancesService {
  private readonly logger = new Logger(BalancesService.name);

  constructor(
    @InjectRepository(Balance) private readonly repo: Repository<Balance>,
    private readonly dataSource: DataSource,
    private readonly hcm: HcmClient,
  ) {}

  listForEmployee(employeeId: string): Promise<Balance[]> {
    return this.repo.find({ where: { employeeId } });
  }

  findOne(employeeId: string, locationId: string): Promise<Balance | null> {
    return this.repo.findOne({ where: { employeeId, locationId } });
  }

  async getOrFail(employeeId: string, locationId: string): Promise<Balance> {
    const b = await this.findOne(employeeId, locationId);
    if (!b) throw DomainErrors.notFound(`balance ${employeeId}/${locationId}`);
    return b;
  }

  /** Pull from HCM and upsert local cache. Returns the resulting local row. */
  async refreshFromHcm(employeeId: string, locationId: string): Promise<Balance> {
    const result = await this.hcm.getBalance(employeeId, locationId);
    if (result.status === 'UNAVAILABLE') {
      throw DomainErrors.hcmUnavailable(result.cause);
    }
    if (result.status === 'NOT_FOUND') {
      // Mark local row STALE if it exists, otherwise nothing to update.
      const existing = await this.findOne(employeeId, locationId);
      if (existing) {
        existing.status = 'STALE';
        existing.lastSyncedAt = new Date();
        await this.repo.save(existing);
        return existing;
      }
      throw DomainErrors.notFound(`balance ${employeeId}/${locationId}`);
    }
    return this.applyHcmBalance(result.data);
  }

  /** Idempotent upsert from HCM (webhook or batch). Returns the saved row. */
  async applyHcmBalance(input: {
    employeeId: string;
    locationId: string;
    balanceDays: number;
    hcmUpdatedAt: string;
  }): Promise<Balance> {
    const existing = await this.findOne(input.employeeId, input.locationId);
    const hcmTime = new Date(input.hcmUpdatedAt);
    if (existing) {
      // Only accept if HCM's timestamp is newer (avoid overwriting with stale webhook).
      if (existing.hcmUpdatedAt && existing.hcmUpdatedAt > hcmTime) {
        return existing;
      }
      existing.balanceDays = input.balanceDays;
      existing.hcmUpdatedAt = hcmTime;
      existing.lastSyncedAt = new Date();
      existing.status = 'OK';
      return this.repo.save(existing);
    }
    const created = this.repo.create({
      employeeId: input.employeeId,
      locationId: input.locationId,
      balanceDays: input.balanceDays,
      hcmUpdatedAt: hcmTime,
      lastSyncedAt: new Date(),
      status: 'OK',
    });
    return this.repo.save(created);
  }

  /**
   * Decrement balance with optimistic-lock retry. Throws STALE_BALANCE if
   * concurrent updates win every retry.
   */
  async decrement(
    employeeId: string,
    locationId: string,
    days: number,
    em?: EntityManager,
  ): Promise<Balance> {
    return this.mutate(employeeId, locationId, -days, em);
  }

  async increment(
    employeeId: string,
    locationId: string,
    days: number,
    em?: EntityManager,
  ): Promise<Balance> {
    return this.mutate(employeeId, locationId, +days, em);
  }

  private async mutate(
    employeeId: string,
    locationId: string,
    delta: number,
    em?: EntityManager,
  ): Promise<Balance> {
    const repo = em ? em.getRepository(Balance) : this.repo;
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const row = await repo.findOne({ where: { employeeId, locationId } });
      if (!row) throw DomainErrors.notFound(`balance ${employeeId}/${locationId}`);
      if (row.status === 'STALE') {
        throw DomainErrors.balanceStaleBlocked(employeeId, locationId);
      }
      const newDays = row.balanceDays + delta;
      if (newDays < 0) {
        throw DomainErrors.insufficientBalance(row.balanceDays, -delta);
      }
      row.balanceDays = newDays;
      try {
        return await repo.save(row);
      } catch (e) {
        const msg = (e as Error).message ?? '';
        if (msg.toLowerCase().includes('optimistic') || msg.toLowerCase().includes('version')) {
          if (attempt === MAX_ATTEMPTS) throw DomainErrors.staleBalance();
          continue;
        }
        throw e;
      }
    }
    throw DomainErrors.staleBalance();
  }
}
