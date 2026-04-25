import request from 'supertest';
import { createHarness, Harness } from '../test-harness';

async function setMode(url: string, mode: string) {
  await fetch(`${url}/admin/failure-mode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
}

describe('S3 — HCM rejects after manager approval', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
    await h.seed.location('LOC_NYC');
    await h.seed.employee('EMP_1', 'Alice');
    await h.seed.balance('EMP_1', 'LOC_NYC', 10);
  });

  afterEach(() => h.close());

  it('rolls back to HCM_REJECTED and refunds the local balance', async () => {
    await setMode(h.mockHcmUrl, 'REJECT_ALL');

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
    await request(h.timeOff.getHttpServer())
      .post(`/time-off-requests/${create.body.id}/approve`)
      .send({ managerId: 'MGR_1' });

    // Local balance immediately reflects the debit
    let bal = await request(h.timeOff.getHttpServer()).get('/employees/EMP_1/balances/LOC_NYC');
    expect(bal.body.balanceDays).toBe(7);

    await h.worker.drain();

    const final = await request(h.timeOff.getHttpServer())
      .get(`/time-off-requests/${create.body.id}`)
      .expect(200);
    expect(final.body.status).toBe('HCM_REJECTED');
    expect(final.body.balanceDecremented).toBe(false);

    // Local balance refunded
    bal = await request(h.timeOff.getHttpServer()).get('/employees/EMP_1/balances/LOC_NYC');
    expect(bal.body.balanceDays).toBe(10);
  });
});
