import request from 'supertest';
import { createHarness, Harness } from '../test-harness';

describe('S8 — Idempotent submit via Idempotency-Key', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
    await h.seed.location('LOC_NYC');
    await h.seed.employee('EMP_1', 'Alice');
    await h.seed.balance('EMP_1', 'LOC_NYC', 10);
  });

  afterEach(() => h.close());

  it('returns the same request twice for the same key', async () => {
    const body = {
      employeeId: 'EMP_1',
      locationId: 'LOC_NYC',
      startDate: '2026-05-01',
      endDate: '2026-05-02',
      days: 2,
    };
    const a = await request(h.timeOff.getHttpServer())
      .post('/time-off-requests')
      .set('Idempotency-Key', 'IK-001')
      .send(body)
      .expect(201);
    const b = await request(h.timeOff.getHttpServer())
      .post('/time-off-requests')
      .set('Idempotency-Key', 'IK-001')
      .send(body)
      .expect(201);
    expect(b.body.id).toBe(a.body.id);

    const list = await request(h.timeOff.getHttpServer()).get('/time-off-requests');
    expect(list.body).toHaveLength(1);
  });

  it('returns IDEMPOTENCY_CONFLICT when key reused with a different payload', async () => {
    await request(h.timeOff.getHttpServer())
      .post('/time-off-requests')
      .set('Idempotency-Key', 'IK-002')
      .send({
        employeeId: 'EMP_1',
        locationId: 'LOC_NYC',
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        days: 2,
      })
      .expect(201);
    const conflict = await request(h.timeOff.getHttpServer())
      .post('/time-off-requests')
      .set('Idempotency-Key', 'IK-002')
      .send({
        employeeId: 'EMP_1',
        locationId: 'LOC_NYC',
        startDate: '2026-05-10',
        endDate: '2026-05-11',
        days: 1,
      });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('outbox idempotency key prevents double-debit even if drain runs twice', async () => {
    const create = await request(h.timeOff.getHttpServer())
      .post('/time-off-requests')
      .send({
        employeeId: 'EMP_1',
        locationId: 'LOC_NYC',
        startDate: '2026-05-01',
        endDate: '2026-05-01',
        days: 1,
      });
    await request(h.timeOff.getHttpServer())
      .post(`/time-off-requests/${create.body.id}/approve`)
      .send({ managerId: 'MGR_1' });
    await h.worker.drain();
    await h.worker.drain();
    await h.worker.drain();
    const hcmBal = await fetch(`${h.mockHcmUrl}/balances/EMP_1/LOC_NYC`).then((r) => r.json());
    expect(hcmBal.balanceDays).toBe(9);
  });
});
