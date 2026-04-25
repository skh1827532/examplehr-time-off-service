import { computeBackoffMs } from './backoff';

describe('computeBackoffMs', () => {
  it('grows roughly exponentially for small attempt counts', () => {
    const a1 = computeBackoffMs(1);
    const a2 = computeBackoffMs(2);
    const a3 = computeBackoffMs(3);
    expect(a1).toBeGreaterThanOrEqual(2_000);
    expect(a2).toBeGreaterThanOrEqual(4_000);
    expect(a3).toBeGreaterThanOrEqual(8_000);
  });

  it('caps at 5 minutes', () => {
    const a20 = computeBackoffMs(20);
    expect(a20).toBeLessThanOrEqual(5 * 60 * 1000 + 250);
  });

  it('adds jitter (non-deterministic)', () => {
    const set = new Set<number>();
    for (let i = 0; i < 10; i++) set.add(computeBackoffMs(2));
    expect(set.size).toBeGreaterThan(1);
  });
});
