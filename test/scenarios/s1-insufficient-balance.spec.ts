import request from 'supertest';
import { createHarness, Harness } from '../test-harness';

describe('S1 — Insufficient balance pre-flight', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
    await h.seed.location('LOC_NYC');
    await h.seed.employee('EMP_1', 'Alice', 'LOC_NYC');
    await h.seed.balance('EMP_1', 'LOC_NYC', 3); // only 3 days available
  });

  afterEach(() => h.close());

  it('rejects POST /time-off-requests when days > balance', async () => {
    const res = await request(h.timeOff.getHttpServer())
      .post('/time-off-requests')
      .send({
        employeeId: 'EMP_1',
        locationId: 'LOC_NYC',
        startDate: '2026-05-01',
        endDate: '2026-05-05',
        days: 5,
      });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INSUFFICIENT_BALANCE');
    expect(res.body.details).toMatchObject({ have: 3, need: 5 });
  });

  it('does not write a request row when pre-flight fails', async () => {
    await request(h.timeOff.getHttpServer())
      .post('/time-off-requests')
      .send({
        employeeId: 'EMP_1',
        locationId: 'LOC_NYC',
        startDate: '2026-05-01',
        endDate: '2026-05-05',
        days: 5,
      });
    const list = await request(h.timeOff.getHttpServer()).get('/time-off-requests');
    expect(list.body).toHaveLength(0);
  });

  it('rejects when location is unknown', async () => {
    const res = await request(h.timeOff.getHttpServer())
      .post('/time-off-requests')
      .send({
        employeeId: 'EMP_1',
        locationId: 'LOC_UNKNOWN',
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        days: 2,
      });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('UNKNOWN_LOCATION');
  });

  it('rejects when startDate > endDate', async () => {
    const res = await request(h.timeOff.getHttpServer())
      .post('/time-off-requests')
      .send({
        employeeId: 'EMP_1',
        locationId: 'LOC_NYC',
        startDate: '2026-05-10',
        endDate: '2026-05-05',
        days: 1,
      });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_DATE_RANGE');
  });
});
