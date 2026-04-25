import { Injectable } from '@nestjs/common';

export type FailureMode =
  | 'NORMAL'
  | 'DOWN'                  // 503 on every write
  | 'TIMEOUT'               // sleep > client timeout then succeed
  | 'SILENT_ACCEPT'         // returns 200 but does NOT actually persist (the brief's defensive case)
  | 'REJECT_ALL'            // returns 422 for every write
  | 'INSUFFICIENT_BALANCE'  // returns 422 INSUFFICIENT_BALANCE for every write
  | 'FLAKY';                // first call fails, retries succeed

@Injectable()
export class FailureModeService {
  private mode: FailureMode = 'NORMAL';
  private latencyMs = 0;
  private flakyCounter = new Map<string, number>();
  private flakyFailEvery = 1; // first attempt fails, second succeeds

  setMode(mode: FailureMode): void {
    this.mode = mode;
    this.flakyCounter.clear();
  }

  getMode(): FailureMode {
    return this.mode;
  }

  setLatencyMs(ms: number): void {
    this.latencyMs = Math.max(0, ms);
  }

  getLatencyMs(): number {
    return this.latencyMs;
  }

  reset(): void {
    this.mode = 'NORMAL';
    this.latencyMs = 0;
    this.flakyCounter.clear();
  }

  /** For FLAKY: returns true if this attempt should fail. */
  shouldFlakyFail(idempotencyKey: string): boolean {
    if (this.mode !== 'FLAKY') return false;
    const n = (this.flakyCounter.get(idempotencyKey) ?? 0) + 1;
    this.flakyCounter.set(idempotencyKey, n);
    return n <= this.flakyFailEvery;
  }
}
