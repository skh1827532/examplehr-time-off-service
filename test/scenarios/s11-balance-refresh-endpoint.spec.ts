import request from 'supertest';
import { createHarness, Harness } from '../test-harness';

describe('S11 — Balance refresh endpoint pulls realtime from HCM', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
    await h.seed.location('LOC_NYC');
    await h.seed.employee('EMP_1', 'Alice');
    await h.seed.balance('EMP_1', 'LOC_NYC', 10);
  });

  afterEach(() => h.close());

  it('returns local-cached value without ?refresh', async () => {
    // Mutate HCM out-of-band
    await fetch(`${h.mockHcmUrl}/admin/balances/mutate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ employeeId: 'EMP_1', locationId: 'LOC_NYC', balanceDays: 99 }),
    });
    const cached = await request(h.timeOff.getHttpServer()).get('/employees/EMP_1/balances/LOC_NYC');
    expect(cached.body.balanceDays).toBe(10);
  });

  it('pulls from HCM when ?refresh=true', async () => {
    await fetch(`${h.mockHcmUrl}/admin/balances/mutate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ employeeId: 'EMP_1', locationId: 'LOC_NYC', balanceDays: 42 }),
    });
    const fresh = await request(h.timeOff.getHttpServer())
      .get('/employees/EMP_1/balances/LOC_NYC?refresh=true')
      .expect(200);
    expect(fresh.body.balanceDays).toBe(42);

    const cachedAfter = await request(h.timeOff.getHttpServer()).get('/employees/EMP_1/balances/LOC_NYC');
    expect(cachedAfter.body.balanceDays).toBe(42);
  });

  it('returns 503 when HCM is unavailable on refresh', async () => {
    await fetch(`${h.mockHcmUrl}/admin/failure-mode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'DOWN' }),
    });
    const res = await request(h.timeOff.getHttpServer()).get(
      '/employees/EMP_1/balances/LOC_NYC?refresh=true',
    );
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('HCM_UNAVAILABLE');
  });
});
