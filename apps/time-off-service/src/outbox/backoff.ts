/**
 * Exponential backoff with jitter, capped at 5 minutes.
 * Returns delay in ms for the given attempt count (1-indexed).
 */
export function computeBackoffMs(attempts: number): number {
  const base = 1_000;            // 1s
  const cap = 5 * 60 * 1_000;    // 5 min
  const exp = Math.min(cap, base * Math.pow(2, Math.min(attempts, 10)));
  const jitter = Math.random() * 250;
  return Math.floor(exp + jitter);
}
