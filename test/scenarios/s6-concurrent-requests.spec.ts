import request from 'supertest';
import { createHarness, Harness } from '../test-harness';

describe('S6 — Concurrent requests racing the same balance', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
    await h.seed.location('LOC_NYC');
    await h.seed.employee('EMP_1', 'Alice');
    await h.seed.balance('EMP_1', 'LOC_NYC', 5);
  });

  afterEach(() => h.close());

  it('rejects the request that pushes total over the balance', async () => {
    // Two non-overlapping requests of 3 days each — sum 6 > 5 balance.
    const a = request(h.timeOff.getHttpServer())
      .post('/time-off-requests')
      .send({
        employeeId: 'EMP_1',
        locationId: 'LOC_NYC',
        startDate: '2026-05-01',
        endDate: '2026-05-03',
        days: 3,
      });
    const b = request(h.timeOff.getHttpServer())
      .post('/time-off-requests')
      .send({
        employeeId: 'EMP_1',
        locationId: 'LOC_NYC',
        startDate: '2026-05-10',
        endDate: '2026-05-12',
        days: 3,
      });
    const [resA, resB] = await Promise.all([a, b]);
    const statuses = [resA.status, resB.status].sort();
    // One of them must be 422 (insufficient balance after counting in-flight)
    expect(statuses).toEqual([201, 422]);
    const rejected = [resA, resB].find((r) => r.status === 422)!;
    expect(rejected.body.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('rejects overlapping date ranges with OVERLAPPING_REQUEST', async () => {
    // Bump balance so overlap (not balance) is the reason for rejection.
    await new Promise((r) => setTimeout(r, 5));
    await h.seed.balance('EMP_1', 'LOC_NYC', 100);
    await request(h.timeOff.getHttpServer())
      .post('/time-off-requests')
      .send({
        employeeId: 'EMP_1',
        locationId: 'LOC_NYC',
        startDate: '2026-05-01',
        endDate: '2026-05-05',
        days: 5,
      })
      .expect(201);

    const overlap = await request(h.timeOff.getHttpServer())
      .post('/time-off-requests')
      .send({
        employeeId: 'EMP_1',
        locationId: 'LOC_NYC',
        startDate: '2026-05-04',
        endDate: '2026-05-06',
        days: 1,
      });
    expect(overlap.status).toBe(422);
    expect(overlap.body.code).toBe('OVERLAPPING_REQUEST');
  });
});
