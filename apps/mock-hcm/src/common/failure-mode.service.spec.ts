import { FailureModeService } from './failure-mode.service';

describe('FailureModeService', () => {
  let svc: FailureModeService;

  beforeEach(() => {
    svc = new FailureModeService();
  });

  it('defaults to NORMAL', () => {
    expect(svc.getMode()).toBe('NORMAL');
    expect(svc.getLatencyMs()).toBe(0);
  });

  it('toggles modes', () => {
    svc.setMode('DOWN');
    expect(svc.getMode()).toBe('DOWN');
  });

  it('shouldFlakyFail returns false when not in FLAKY mode', () => {
    svc.setMode('NORMAL');
    expect(svc.shouldFlakyFail('k')).toBe(false);
  });

  it('shouldFlakyFail fails first attempt then succeeds', () => {
    svc.setMode('FLAKY');
    expect(svc.shouldFlakyFail('k')).toBe(true);  // fails
    expect(svc.shouldFlakyFail('k')).toBe(false); // succeeds
  });

  it('reset clears state', () => {
    svc.setMode('DOWN');
    svc.setLatencyMs(100);
    svc.reset();
    expect(svc.getMode()).toBe('NORMAL');
    expect(svc.getLatencyMs()).toBe(0);
  });

  it('clamps negative latency to 0', () => {
    svc.setLatencyMs(-100);
    expect(svc.getLatencyMs()).toBe(0);
  });
});
