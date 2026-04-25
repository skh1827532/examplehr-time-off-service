import { createHarness, Harness } from '../test-harness';
import { HcmClient } from '../../apps/time-off-service/src/hcm/hcm.client';

async function setMode(url: string, mode: string) {
  await fetch(`${url}/admin/failure-mode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
}

describe('HcmClient', () => {
  let h: Harness;
  let client: HcmClient;

  beforeEach(async () => {
    h = await createHarness();
    client = h.timeOff.get(HcmClient);
    await fetch(`${h.mockHcmUrl}/admin/seed/balances`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ balances: [{ employeeId: 'E', locationId: 'L', balanceDays: 10 }] }),
    });
  });

  afterEach(() => h.close());

  it('getBalance OK path', async () => {
    const r = await client.getBalance('E', 'L');
    expect(r.status).toBe('OK');
    if (r.status === 'OK') expect(r.data.balanceDays).toBe(10);
  });

  it('getBalance NOT_FOUND when missing', async () => {
    const r = await client.getBalance('GHOST', 'L');
    expect(r.status).toBe('NOT_FOUND');
  });

  it('getBalance UNAVAILABLE when HCM is down', async () => {
    await setMode(h.mockHcmUrl, 'DOWN');
    const r = await client.getBalance('E', 'L');
    expect(r.status).toBe('UNAVAILABLE');
  });

  it('getBatch OK', async () => {
    const r = await client.getBatch();
    expect(r.status).toBe('OK');
    if (r.status === 'OK') expect(r.data.balances).toHaveLength(1);
  });

  it('submitTransaction OK', async () => {
    const r = await client.submitTransaction({
      idempotencyKey: 'k1',
      employeeId: 'E',
      locationId: 'L',
      days: 1,
      type: 'DEBIT',
    });
    expect(r.status).toBe('OK');
  });

  it('submitTransaction REJECTED when HCM 4xx', async () => {
    await setMode(h.mockHcmUrl, 'REJECT_ALL');
    const r = await client.submitTransaction({
      idempotencyKey: 'k2',
      employeeId: 'E',
      locationId: 'L',
      days: 1,
      type: 'DEBIT',
    });
    expect(r.status).toBe('REJECTED');
  });

  it('submitTransaction UNAVAILABLE when HCM is down', async () => {
    await setMode(h.mockHcmUrl, 'DOWN');
    const r = await client.submitTransaction({
      idempotencyKey: 'k3',
      employeeId: 'E',
      locationId: 'L',
      days: 1,
      type: 'DEBIT',
    });
    expect(r.status).toBe('UNAVAILABLE');
  });

  it('opens circuit after threshold of failures and short-circuits', async () => {
    await setMode(h.mockHcmUrl, 'DOWN');
    for (let i = 0; i < 5; i++) {
      await client.submitTransaction({
        idempotencyKey: `c${i}`,
        employeeId: 'E',
        locationId: 'L',
        days: 1,
        type: 'DEBIT',
      });
    }
    const r = await client.submitTransaction({
      idempotencyKey: 'c-after',
      employeeId: 'E',
      locationId: 'L',
      days: 1,
      type: 'DEBIT',
    });
    expect(r.status).toBe('UNAVAILABLE');
    if (r.status === 'UNAVAILABLE') expect(r.cause).toBe('circuit-open');
  });

  it('resetCircuit clears the open state', async () => {
    await setMode(h.mockHcmUrl, 'DOWN');
    for (let i = 0; i < 6; i++) {
      await client.submitTransaction({
        idempotencyKey: `r${i}`,
        employeeId: 'E',
        locationId: 'L',
        days: 1,
        type: 'DEBIT',
      });
    }
    client.resetCircuit();
    await setMode(h.mockHcmUrl, 'NORMAL');
    const r = await client.submitTransaction({
      idempotencyKey: 'r-ok',
      employeeId: 'E',
      locationId: 'L',
      days: 1,
      type: 'DEBIT',
    });
    expect(r.status).toBe('OK');
  });
});
