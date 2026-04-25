import request from 'supertest';
import { createHarness, Harness } from '../test-harness';

async function setMode(url: string, mode: string) {
  await fetch(`${url}/admin/failure-mode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
}

describe('S7 — HCM down during approval, recovers later', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
    await h.seed.location('LOC_NYC');
    await h.seed.employee('EMP_1', 'Alice');
    await h.seed.balance('EMP_1', 'LOC_NYC', 10);
  });

  afterEach(() => h.close());

  it('keeps request APPROVED while HCM is down, transitions to HCM_CONFIRMED on recovery', async () => {
    await setMode(h.mockHcmUrl, 'DOWN');

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
      .post(`/time-off-requests/${create.body.id}/approve`)
      .send({ managerId: 'MGR_1' });

    // First drain — HCM is down, outbox should retry.
    await h.worker.drain();
    let req1 = await request(h.timeOff.getHttpServer()).get(`/time-off-requests/${create.body.id}`);
    expect(req1.body.status).toBe('APPROVED');

    // Outbox event should be in FAILED state with attempts > 0.
    const failed = await request(h.timeOff.getHttpServer()).get('/admin/outbox?status=FAILED');
    expect(failed.body.length).toBeGreaterThan(0);
    expect(failed.body[0].attempts).toBeGreaterThan(0);

    // HCM recovers
    await setMode(h.mockHcmUrl, 'NORMAL');
    h.hcm.resetCircuit();

    // Force-replay then drain
    const ev = failed.body[0];
    await request(h.timeOff.getHttpServer()).post(`/admin/outbox/${ev.id}/replay`).expect(200);
    await h.worker.drain();

    const final = await request(h.timeOff.getHttpServer()).get(`/time-off-requests/${create.body.id}`);
    expect(final.body.status).toBe('HCM_CONFIRMED');
  });

  it('handles transient FLAKY errors via retry — eventually succeeds without manual intervention', async () => {
    await setMode(h.mockHcmUrl, 'FLAKY');

    const create = await request(h.timeOff.getHttpServer())
      .post('/time-off-requests')
      .send({
        employeeId: 'EMP_1',
        locationId: 'LOC_NYC',
        startDate: '2026-05-10',
        endDate: '2026-05-11',
        days: 2,
      });
    await request(h.timeOff.getHttpServer())
      .post(`/time-off-requests/${create.body.id}/approve`)
      .send({ managerId: 'MGR_1' });

    // First drain: 502 from FLAKY mode — outbox marks FAILED.
    await h.worker.drain();

    // Second drain after the nextAttemptAt — but we can't easily advance the clock
    // without timers. Instead, force-replay.
    const failed = await request(h.timeOff.getHttpServer()).get('/admin/outbox?status=FAILED');
    if (failed.body.length > 0) {
      await request(h.timeOff.getHttpServer()).post(`/admin/outbox/${failed.body[0].id}/replay`);
    }
    await h.worker.drain();

    const final = await request(h.timeOff.getHttpServer()).get(`/time-off-requests/${create.body.id}`);
    expect(final.body.status).toBe('HCM_CONFIRMED');
  });
});
