import request from 'supertest';
import { createHarness, Harness } from '../test-harness';

describe('S9 — Cancellation refund flows', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
    await h.seed.location('LOC_NYC');
    await h.seed.employee('EMP_1', 'Alice');
    await h.seed.balance('EMP_1', 'LOC_NYC', 10);
  });

  afterEach(() => h.close());

  it('cancels a PENDING request without touching balance', async () => {
    const create = await request(h.timeOff.getHttpServer())
      .post('/time-off-requests')
      .send({
        employeeId: 'EMP_1',
        locationId: 'LOC_NYC',
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        days: 2,
      })
      .expect(201);
    await request(h.timeOff.getHttpServer())
      .post(`/time-off-requests/${create.body.id}/cancel`)
      .send({ actorId: 'EMP_1' })
      .expect(201);

    const final = await request(h.timeOff.getHttpServer()).get(`/time-off-requests/${create.body.id}`);
    expect(final.body.status).toBe('CANCELLED');

    const bal = await request(h.timeOff.getHttpServer()).get('/employees/EMP_1/balances/LOC_NYC');
    expect(bal.body.balanceDays).toBe(10);
  });

  it('cancels an HCM_CONFIRMED request, refunds locally, and pushes a CREDIT to HCM', async () => {
    const create = await request(h.timeOff.getHttpServer())
      .post('/time-off-requests')
      .send({
        employeeId: 'EMP_1',
        locationId: 'LOC_NYC',
        startDate: '2026-05-01',
        endDate: '2026-05-03',
        days: 3,
      });
    await request(h.timeOff.getHttpServer())
      .post(`/time-off-requests/${create.body.id}/approve`)
      .send({ managerId: 'MGR_1' });
    await h.worker.drain();

    let hcmBal = await fetch(`${h.mockHcmUrl}/balances/EMP_1/LOC_NYC`).then((r) => r.json());
    expect(hcmBal.balanceDays).toBe(7);

    await request(h.timeOff.getHttpServer())
      .post(`/time-off-requests/${create.body.id}/cancel`)
      .send({ actorId: 'EMP_1', reason: 'changed mind' })
      .expect(201);

    // Local balance refunded immediately
    const bal = await request(h.timeOff.getHttpServer()).get('/employees/EMP_1/balances/LOC_NYC');
    expect(bal.body.balanceDays).toBe(10);

    // Credit outbox event drained → HCM also refunded
    await h.worker.drain();
    hcmBal = await fetch(`${h.mockHcmUrl}/balances/EMP_1/LOC_NYC`).then((r) => r.json());
    expect(hcmBal.balanceDays).toBe(10);
  });
});
