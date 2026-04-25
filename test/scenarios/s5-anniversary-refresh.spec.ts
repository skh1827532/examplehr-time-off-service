import request from 'supertest';
import { createHarness, Harness } from '../test-harness';

describe('S5 — Anniversary refresh during pending request', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
    await h.seed.location('LOC_NYC');
    await h.seed.employee('EMP_1', 'Alice');
    await h.seed.balance('EMP_1', 'LOC_NYC', 5);
  });

  afterEach(() => h.close());

  it('revokes a PENDING request when HCM webhook drops the balance below requested days', async () => {
    // Employee submits a 4-day request — fits in current 5-day balance.
    const create = await request(h.timeOff.getHttpServer())
      .post('/time-off-requests')
      .send({
        employeeId: 'EMP_1',
        locationId: 'LOC_NYC',
        startDate: '2026-05-01',
        endDate: '2026-05-04',
        days: 4,
      })
      .expect(201);
    expect(create.body.status).toBe('PENDING_APPROVAL');

    // HCM corrects the balance overnight — say someone in HR fixed an error.
    await request(h.timeOff.getHttpServer())
      .post('/webhooks/hcm/balance-updated')
      .send({
        employeeId: 'EMP_1',
        locationId: 'LOC_NYC',
        balanceDays: 1,
        hcmUpdatedAt: new Date().toISOString(),
        source: 'HR_CORRECTION',
      })
      .expect(201);

    // The pending request should now be HCM_REJECTED with reason 'balance_revoked'.
    const final = await request(h.timeOff.getHttpServer())
      .get(`/time-off-requests/${create.body.id}`)
      .expect(200);
    expect(final.body.status).toBe('HCM_REJECTED');
    expect(final.body.rejectionReason).toBe('balance_revoked');
  });

  it('keeps a PENDING request alive when balance increases (anniversary bonus)', async () => {
    const create = await request(h.timeOff.getHttpServer())
      .post('/time-off-requests')
      .send({
        employeeId: 'EMP_1',
        locationId: 'LOC_NYC',
        startDate: '2026-05-01',
        endDate: '2026-05-03',
        days: 3,
      })
      .expect(201);

    // Anniversary: balance jumps to 15
    await request(h.timeOff.getHttpServer())
      .post('/webhooks/hcm/balance-updated')
      .send({
        employeeId: 'EMP_1',
        locationId: 'LOC_NYC',
        balanceDays: 15,
        hcmUpdatedAt: new Date().toISOString(),
        source: 'ANNIVERSARY',
      })
      .expect(201);

    const final = await request(h.timeOff.getHttpServer())
      .get(`/time-off-requests/${create.body.id}`)
      .expect(200);
    expect(final.body.status).toBe('PENDING_APPROVAL');

    // Sync log records DRIFT (since 5 → 15 is a change)
    const log = await request(h.timeOff.getHttpServer()).get('/admin/sync-log?result=DRIFT');
    expect(log.body.length).toBeGreaterThan(0);
  });
});
