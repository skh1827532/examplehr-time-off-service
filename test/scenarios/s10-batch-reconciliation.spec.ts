import request from 'supertest';
import { createHarness, Harness } from '../test-harness';

describe('S10 — Batch reconciliation', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
    await h.seed.location('LOC_NYC');
    await h.seed.location('LOC_SFO');
    await h.seed.employee('EMP_1', 'Alice');
    await h.seed.employee('EMP_2', 'Bob');
  });

  afterEach(() => h.close());

  it('creates local rows for HCM balances we did not previously have', async () => {
    // Mock HCM has two new balances we don't.
    await h.seed.hcmBalance('EMP_1', 'LOC_NYC', 10);
    await h.seed.hcmBalance('EMP_2', 'LOC_SFO', 5);

    const batch = await fetch(`${h.mockHcmUrl}/batch/balances`).then((r) => r.json());
    const res = await request(h.timeOff.getHttpServer())
      .post('/sync/hcm/batch')
      .send(batch)
      .expect(201);
    expect(res.body.created).toBe(2);
    expect(res.body.applied).toBe(2);

    const bal1 = await request(h.timeOff.getHttpServer()).get('/employees/EMP_1/balances/LOC_NYC');
    expect(bal1.body.balanceDays).toBe(10);
    const bal2 = await request(h.timeOff.getHttpServer()).get('/employees/EMP_2/balances/LOC_SFO');
    expect(bal2.body.balanceDays).toBe(5);
  });

  it('marks local balances STALE when missing from HCM batch and blocks new requests', async () => {
    // We have a local balance that HCM no longer reports.
    await h.seed.balance('EMP_1', 'LOC_NYC', 10);

    // HCM only sends EMP_2.
    await h.seed.hcmBalance('EMP_2', 'LOC_SFO', 3);
    const batch = {
      generatedAt: new Date().toISOString(),
      balances: [{ employeeId: 'EMP_2', locationId: 'LOC_SFO', balanceDays: 3, hcmUpdatedAt: new Date().toISOString() }],
    };

    const res = await request(h.timeOff.getHttpServer())
      .post('/sync/hcm/batch')
      .send(batch)
      .expect(201);
    expect(res.body.staled).toBe(1);

    // Trying to request against the stale balance must fail.
    const fail = await request(h.timeOff.getHttpServer())
      .post('/time-off-requests')
      .send({
        employeeId: 'EMP_1',
        locationId: 'LOC_NYC',
        startDate: '2026-05-01',
        endDate: '2026-05-01',
        days: 1,
      });
    expect(fail.status).toBe(422);
    expect(fail.body.code).toBe('BALANCE_STALE_BLOCKED');
  });

  it('records DRIFT in sync log when batch balance differs from local', async () => {
    await h.seed.balance('EMP_1', 'LOC_NYC', 10);

    // HCM now says 7 — drift of 3
    const batch = {
      generatedAt: new Date().toISOString(),
      balances: [{ employeeId: 'EMP_1', locationId: 'LOC_NYC', balanceDays: 7, hcmUpdatedAt: new Date().toISOString() }],
    };
    const res = await request(h.timeOff.getHttpServer())
      .post('/sync/hcm/batch')
      .send(batch)
      .expect(201);
    expect(res.body.drift).toBe(1);

    const log = await request(h.timeOff.getHttpServer()).get('/admin/sync-log?result=DRIFT');
    expect(log.body.length).toBeGreaterThan(0);
  });
});
