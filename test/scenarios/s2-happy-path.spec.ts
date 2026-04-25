import request from 'supertest';
import { createHarness, Harness } from '../test-harness';

describe('S2 — Happy path: create → approve → HCM confirm', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
    await h.seed.location('LOC_NYC');
    await h.seed.employee('EMP_1', 'Alice', 'LOC_NYC');
    await h.seed.balance('EMP_1', 'LOC_NYC', 10);
  });

  afterEach(() => h.close());

  it('transitions PENDING → APPROVED → HCM_CONFIRMED and decrements balance once', async () => {
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
    expect(create.body.status).toBe('PENDING_APPROVAL');
    const id = create.body.id;

    // Manager approves
    const approve = await request(h.timeOff.getHttpServer())
      .post(`/time-off-requests/${id}/approve`)
      .send({ managerId: 'MGR_1' })
      .expect(201);
    expect(approve.body.status).toBe('APPROVED');
    expect(approve.body.balanceDecremented).toBe(true);

    // Local balance reflects the debit
    const bal1 = await request(h.timeOff.getHttpServer())
      .get(`/employees/EMP_1/balances/LOC_NYC`)
      .expect(200);
    expect(bal1.body.balanceDays).toBe(8);

    // Drain outbox
    const drainResult = await h.worker.drain();
    expect(drainResult.processed).toBeGreaterThan(0);

    // Final state
    const final = await request(h.timeOff.getHttpServer())
      .get(`/time-off-requests/${id}`)
      .expect(200);
    expect(final.body.status).toBe('HCM_CONFIRMED');
    expect(final.body.hcmTransactionId).toBeTruthy();
    expect(final.body.hcmConfirmedAt).toBeTruthy();

    // Mock HCM also reflects the debit
    const hcmBal = await fetch(`${h.mockHcmUrl}/balances/EMP_1/LOC_NYC`).then((r) => r.json());
    expect(hcmBal.balanceDays).toBe(8);
  });

  it('only decrements once even if drain runs twice', async () => {
    const create = await request(h.timeOff.getHttpServer())
      .post('/time-off-requests')
      .send({
        employeeId: 'EMP_1',
        locationId: 'LOC_NYC',
        startDate: '2026-05-01',
        endDate: '2026-05-01',
        days: 1,
      })
      .expect(201);
    await request(h.timeOff.getHttpServer())
      .post(`/time-off-requests/${create.body.id}/approve`)
      .send({ managerId: 'MGR_1' });
    await h.worker.drain();
    await h.worker.drain();
    const hcmBal = await fetch(`${h.mockHcmUrl}/balances/EMP_1/LOC_NYC`).then((r) => r.json());
    expect(hcmBal.balanceDays).toBe(9);
  });
});
