import { sampleHeapUsed } from '../../src/runtime/runner/runner';

describe('sampleHeapUsed', () => {
  it('returns undefined when logHeapUsage is disabled', () => {
    expect(sampleHeapUsed(false)).toBeUndefined();
    expect(sampleHeapUsed(undefined)).toBeUndefined();
  });

  it('returns a heap number when process.memoryUsage is available', () => {
    expect(typeof sampleHeapUsed(true)).toBe('number');
  });

  it('does not crash when process.memoryUsage is unavailable (web bundle)', () => {
    // The shared runner is bundled into the web-target browser runtime, where
    // `process.memoryUsage` does not exist. An unguarded call used to crash
    // with logHeapUsage:true (#1389); the guard must degrade to undefined.
    const original = process.memoryUsage;
    (process as { memoryUsage?: unknown }).memoryUsage = undefined;
    try {
      expect(() => sampleHeapUsed(true)).not.toThrow();
      expect(sampleHeapUsed(true)).toBeUndefined();
    } finally {
      process.memoryUsage = original;
    }
  });
});
