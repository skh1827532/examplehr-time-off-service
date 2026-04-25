import request from 'supertest';
import { createHarness, Harness } from '../test-harness';

async function setMode(url: string, mode: string) {
  await fetch(`${url}/admin/failure-mode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
}

describe('Admin and Outbox endpoints', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
    await h.seed.location('LOC');
    await h.seed.employee('E');
    await h.seed.balance('E', 'LOC', 5);
  });

  afterEach(() => h.close());

  it('GET /admin/sync-log returns log entries with filters', async () => {
    await request(h.timeOff.getHttpServer())
      .post('/webhooks/hcm/balance-updated')
      .send({
        employeeId: 'E',
        locationId: 'LOC',
        balanceDays: 7,
        hcmUpdatedAt: new Date().toISOString(),
      });
    const all = await request(h.timeOff.getHttpServer()).get('/admin/sync-log');
    expect(all.body.length).toBeGreaterThan(0);
    const drift = await request(h.timeOff.getHttpServer()).get('/admin/sync-log?result=DRIFT');
    expect(drift.body.length).toBeGreaterThan(0);
  });

  it('GET /admin/outbox lists events', async () => {
    const list = await request(h.timeOff.getHttpServer()).get('/admin/outbox');
    expect(Array.isArray(list.body)).toBe(true);
  });

  it('POST /admin/outbox/:id/replay 404s for unknown id', async () => {
    const res = await request(h.timeOff.getHttpServer()).post('/admin/outbox/ghost/replay');
    expect(res.status).toBe(404);
  });

  it('POST /admin/sync/full-pull pulls and applies HCM batch', async () => {
    // Mutate HCM out-of-band
    await fetch(`${h.mockHcmUrl}/admin/balances/mutate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ employeeId: 'E', locationId: 'LOC', balanceDays: 99 }),
    });
    const res = await request(h.timeOff.getHttpServer()).post('/admin/sync/full-pull').expect(200);
    expect(res.body.applied).toBeGreaterThanOrEqual(1);
    const bal = await request(h.timeOff.getHttpServer()).get('/employees/E/balances/LOC');
    expect(bal.body.balanceDays).toBe(99);
  });

  it('POST /admin/sync/full-pull returns 503 when HCM down', async () => {
    await setMode(h.mockHcmUrl, 'DOWN');
    const res = await request(h.timeOff.getHttpServer()).post('/admin/sync/full-pull');
    expect(res.status).toBe(503);
  });

  it('POST /admin/outbox/drain returns processed count', async () => {
    const res = await request(h.timeOff.getHttpServer()).post('/admin/outbox/drain').expect(200);
    expect(res.body).toHaveProperty('processed');
  });

  it('marks outbox FAILED_PERMANENT after exceeding max attempts', async () => {
    // Make HCM permanently down, lower max attempts via env we set in the worker
    // — for this test, force a request through and exhaust by replaying many times.
    const create = await request(h.timeOff.getHttpServer())
      .post('/time-off-requests')
      .send({
        employeeId: 'E',
        locationId: 'LOC',
        startDate: '2026-05-01',
        endDate: '2026-05-01',
        days: 1,
      });
    await request(h.timeOff.getHttpServer())
      .post(`/time-off-requests/${create.body.id}/approve`)
      .send({ managerId: 'MGR' });
    await setMode(h.mockHcmUrl, 'DOWN');
    // Replay enough times to exhaust max attempts (default 8)
    for (let i = 0; i < 10; i++) {
      const failed = await request(h.timeOff.getHttpServer()).get('/admin/outbox?status=FAILED');
      if (failed.body.length === 0) {
        // Either still PENDING or already FAILED_PERMANENT
        const fp = await request(h.timeOff.getHttpServer()).get('/admin/outbox?status=FAILED_PERMANENT');
        if (fp.body.length > 0) break;
        await h.worker.drain();
        continue;
      }
      await request(h.timeOff.getHttpServer()).post(`/admin/outbox/${failed.body[0].id}/replay`);
      await h.worker.drain();
    }
    const fp = await request(h.timeOff.getHttpServer()).get('/admin/outbox?status=FAILED_PERMANENT');
    expect(fp.body.length).toBeGreaterThan(0);
  });
});
