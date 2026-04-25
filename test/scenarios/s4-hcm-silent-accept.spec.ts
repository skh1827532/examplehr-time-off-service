import request from 'supertest';
import { createHarness, Harness } from '../test-harness';

async function setMode(url: string, mode: string) {
  await fetch(`${url}/admin/failure-mode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
}

describe('S4 — HCM silently accepts (drift detection)', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
    await h.seed.location('LOC_NYC');
    await h.seed.employee('EMP_1', 'Alice');
    await h.seed.balance('EMP_1', 'LOC_NYC', 10);
  });

  afterEach(() => h.close());

  it('detects drift on next batch when HCM did not actually persist a debit', async () => {
    // Mock HCM accepts the transaction but does NOT mutate the balance.
    await setMode(h.mockHcmUrl, 'SILENT_ACCEPT');

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
    await request(h.timeOff.getHttpServer())
      .post(`/time-off-requests/${create.body.id}/approve`)
      .send({ managerId: 'MGR_1' });
    await h.worker.drain();

    // Local view: balance went 10 → 6 (we trusted the 200)
    let bal = await request(h.timeOff.getHttpServer()).get('/employees/EMP_1/balances/LOC_NYC');
    expect(bal.body.balanceDays).toBe(6);

    // HCM still has 10 (it lied)
    const hcmBal = await fetch(`${h.mockHcmUrl}/balances/EMP_1/LOC_NYC`).then((r) => r.json());
    expect(hcmBal.balanceDays).toBe(10);

    // A nightly batch comes in from HCM with the truth
    const batch = await fetch(`${h.mockHcmUrl}/batch/balances`).then((r) => r.json());
    await request(h.timeOff.getHttpServer())
      .post('/sync/hcm/batch')
      .send(batch)
      .expect(201);

    // Sync log records DRIFT
    const log = await request(h.timeOff.getHttpServer()).get('/admin/sync-log?result=DRIFT');
    expect(log.body.length).toBeGreaterThan(0);
    expect(log.body[0]).toMatchObject({
      employeeId: 'EMP_1',
      locationId: 'LOC_NYC',
      result: 'DRIFT',
    });

    // Local balance now matches HCM (10) — HCM is source of truth
    bal = await request(h.timeOff.getHttpServer()).get('/employees/EMP_1/balances/LOC_NYC');
    expect(bal.body.balanceDays).toBe(10);
  });
});
