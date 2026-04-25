import request from 'supertest';
import { createHarness, Harness } from '../test-harness';
import { BalancesService } from '../../apps/time-off-service/src/balances/balances.service';
import { DomainError } from '../../apps/time-off-service/src/common/domain-errors';

describe('BalancesService — domain behavior', () => {
  let h: Harness;
  let svc: BalancesService;

  beforeEach(async () => {
    h = await createHarness();
    svc = h.timeOff.get(BalancesService);
    await h.seed.location('LOC');
    await h.seed.employee('E');
    await h.seed.balance('E', 'LOC', 5);
  });

  afterEach(() => h.close());

  it('refreshFromHcm pulls latest from HCM and updates local cache', async () => {
    await fetch(`${h.mockHcmUrl}/admin/balances/mutate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ employeeId: 'E', locationId: 'LOC', balanceDays: 22 }),
    });
    const refreshed = await svc.refreshFromHcm('E', 'LOC');
    expect(refreshed.balanceDays).toBe(22);
  });

  it('refreshFromHcm marks local STALE when HCM has no record', async () => {
    await fetch(`${h.mockHcmUrl}/admin/reset`, { method: 'DELETE' });
    const refreshed = await svc.refreshFromHcm('E', 'LOC');
    expect(refreshed.status).toBe('STALE');
  });

  it('refreshFromHcm throws HCM_UNAVAILABLE when HCM is DOWN', async () => {
    await fetch(`${h.mockHcmUrl}/admin/failure-mode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'DOWN' }),
    });
    await expect(svc.refreshFromHcm('E', 'LOC')).rejects.toThrow(DomainError);
  });

  it('decrement throws INSUFFICIENT_BALANCE when below 0', async () => {
    await expect(svc.decrement('E', 'LOC', 999)).rejects.toMatchObject({
      code: 'INSUFFICIENT_BALANCE',
    });
  });

  it('decrement and increment compose', async () => {
    await svc.decrement('E', 'LOC', 2);
    let bal = await svc.getOrFail('E', 'LOC');
    expect(bal.balanceDays).toBe(3);
    await svc.increment('E', 'LOC', 1);
    bal = await svc.getOrFail('E', 'LOC');
    expect(bal.balanceDays).toBe(4);
  });

  it('decrement on STALE balance throws BALANCE_STALE_BLOCKED', async () => {
    // Mark stale by simulating a batch missing this row
    const batch = { generatedAt: new Date().toISOString(), balances: [] };
    await request(h.timeOff.getHttpServer()).post('/sync/hcm/batch').send(batch);
    await expect(svc.decrement('E', 'LOC', 1)).rejects.toMatchObject({
      code: 'BALANCE_STALE_BLOCKED',
    });
  });

  it('applyHcmBalance ignores stale webhook (older timestamp)', async () => {
    const before = await svc.getOrFail('E', 'LOC');
    const oldTs = new Date(before.hcmUpdatedAt!.getTime() - 60_000).toISOString();
    await svc.applyHcmBalance({
      employeeId: 'E',
      locationId: 'LOC',
      balanceDays: 999,
      hcmUpdatedAt: oldTs,
    });
    const after = await svc.getOrFail('E', 'LOC');
    expect(after.balanceDays).toBe(before.balanceDays); // unchanged
  });

  it('listForEmployee returns multiple locations', async () => {
    await h.seed.location('LOC2');
    await h.seed.balance('E', 'LOC2', 7);
    const balances = await svc.listForEmployee('E');
    expect(balances).toHaveLength(2);
  });

  it('getOrFail throws NOT_FOUND for missing balance', async () => {
    await expect(svc.getOrFail('GHOST', 'LOC')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
