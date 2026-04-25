import { HcmStore } from './hcm-store';

describe('HcmStore', () => {
  let store: HcmStore;

  beforeEach(() => {
    store = new HcmStore();
  });

  it('upserts and reads a balance', () => {
    store.upsertBalance({ employeeId: 'e1', locationId: 'l1', balanceDays: 10, hcmUpdatedAt: 't' });
    expect(store.getBalance('e1', 'l1')?.balanceDays).toBe(10);
  });

  it('overwrites on second upsert', () => {
    store.upsertBalance({ employeeId: 'e1', locationId: 'l1', balanceDays: 10, hcmUpdatedAt: 't1' });
    store.upsertBalance({ employeeId: 'e1', locationId: 'l1', balanceDays: 5, hcmUpdatedAt: 't2' });
    expect(store.getBalance('e1', 'l1')?.balanceDays).toBe(5);
  });

  it('deduplicates transactions by idempotency key', () => {
    store.recordTransaction({
      transactionId: 'tx1',
      idempotencyKey: 'k1',
      employeeId: 'e',
      locationId: 'l',
      days: 1,
      type: 'DEBIT',
      recordedAt: 't',
    });
    expect(store.findTransactionByIdempotencyKey('k1')?.transactionId).toBe('tx1');
    expect(store.findTransactionByIdempotencyKey('missing')).toBeNull();
  });

  it('reset clears everything', () => {
    store.upsertBalance({ employeeId: 'e', locationId: 'l', balanceDays: 1, hcmUpdatedAt: 't' });
    store.reset();
    expect(store.listBalances()).toHaveLength(0);
  });
});
