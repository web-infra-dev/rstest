import { MemoryGate, createDefaultMemoryGate } from '../../src/pool/memoryGate';

const MB = 1024 * 1024;

/**
 * Build a MemoryGate with deterministic deps. By default reports an
 * impossibly-tight 1 MB of free memory so the only way `canSpawnNewWorker`
 * passes is via the deadlock or cold-start bypasses.
 */
const makeGate = (
  opts: {
    freemem?: number;
    /** Bytes reported as MemAvailable; falsy → no /proc/meminfo. */
    memAvailable?: number;
  } = {},
) => {
  return new MemoryGate({
    freemem: () => opts.freemem ?? 1 * MB,
    readMeminfo: () =>
      opts.memAvailable
        ? `MemTotal: ${(opts.memAvailable * 4) / 1024} kB\nMemAvailable: ${opts.memAvailable / 1024} kB\n`
        : null,
  });
};

describe('MemoryGate - cold-start & deadlock guards', () => {
  it('should always allow the first worker (activeCount === 0)', () => {
    const gate = makeGate({ freemem: 1 * MB }); // pathologically tight
    expect(gate.canSpawnNewWorker(0)).toBe(true);
  });

  it('should bypass entirely until the first RSS sample arrives', () => {
    const gate = makeGate({ freemem: 1 * MB });
    expect(gate.canSpawnNewWorker(4)).toBe(true);
  });

  it('should engage the gate once a sample has been recorded', () => {
    const gate = makeGate({ freemem: 100 * MB, memAvailable: 100 * MB });
    gate.recordWorkerRss(500 * MB);
    // 100 MB free < 500 MB P90 → fast lane fails → slow lane 100 MB < 500 MB → false.
    expect(gate.canSpawnNewWorker(4)).toBe(false);
  });
});

describe('MemoryGate - fast lane short-circuit', () => {
  it('should fast-pass when freemem ≥ P90(rss) × 3', () => {
    // P90 ≈ 500 MB → threshold 1.5 GB. 2 GB free clearly above.
    const memSpy = rs.fn(() => 2048 * MB);
    const meminfoSpy = rs.fn(() => null);
    const gate = new MemoryGate({ freemem: memSpy, readMeminfo: meminfoSpy });
    for (const v of [400, 450, 500, 500, 500]) gate.recordWorkerRss(v * MB);

    expect(gate.canSpawnNewWorker(4)).toBe(true);
    // Fast lane proven: meminfo (only read in slow lane) was never touched.
    expect(meminfoSpy).not.toHaveBeenCalled();
  });

  it('should engage slow lane only when fast lane fails', () => {
    const meminfoSpy = rs.fn(
      () => 'MemTotal: 2048000 kB\nMemAvailable: 500000 kB\n',
    );
    const gate = new MemoryGate({
      freemem: () => 500 * MB,
      readMeminfo: meminfoSpy,
    });
    for (const v of [600, 700, 800, 800, 800]) gate.recordWorkerRss(v * MB);
    // P90 ≈ 800 MB → fast lane threshold 2.4 GB. 500 MB free trips slow lane.
    expect(gate.canSpawnNewWorker(4)).toBe(false);
    expect(meminfoSpy).toHaveBeenCalled();
  });
});

describe('MemoryGate - heap tracking lazily activates', () => {
  it('should keep recordDispatch as a no-op until slow lane triggers', () => {
    const gate = makeGate();
    // Bypass branch is taken (no samples) — heapTrackingEnabled stays false.
    expect(gate.canSpawnNewWorker(0)).toBe(true);

    // Spy heapUsed reads: a no-op recordDispatch must not call memoryUsage.
    const memSpy = rs.spyOn(process, 'memoryUsage');
    gate.recordDispatch();
    gate.recordResolve();
    expect(memSpy).not.toHaveBeenCalled();
  });

  it('should start sampling heap delta once slow lane fires', () => {
    const gate = makeGate({ freemem: 100 * MB, memAvailable: 100 * MB });
    for (const v of [600, 700, 800]) gate.recordWorkerRss(v * MB);
    // First slow-lane invocation flips `heapTrackingEnabled`.
    gate.canSpawnNewWorker(4);

    const memSpy = rs
      .spyOn(process, 'memoryUsage')
      .mockReturnValueOnce({
        rss: 0,
        heapTotal: 0,
        heapUsed: 100 * MB,
        external: 0,
        arrayBuffers: 0,
      } as NodeJS.MemoryUsage)
      .mockReturnValueOnce({
        rss: 0,
        heapTotal: 0,
        heapUsed: 150 * MB,
        external: 0,
        arrayBuffers: 0,
      } as NodeJS.MemoryUsage);

    gate.recordDispatch();
    gate.recordResolve();
    expect(memSpy).toHaveBeenCalledTimes(2);
  });
});

describe('MemoryGate - RSS sample sanity', () => {
  it('should ignore zero or negative RSS reports', () => {
    const gate = makeGate({ freemem: 1 });
    gate.recordWorkerRss(0);
    gate.recordWorkerRss(-100);
    // Treated as no samples → cold-start bypass still in effect.
    expect(gate.canSpawnNewWorker(4)).toBe(true);
  });
});

describe('createDefaultMemoryGate', () => {
  it('should return undefined when RSTEST_MEMORY_AWARE=0', () => {
    const prev = process.env.RSTEST_MEMORY_AWARE;
    try {
      process.env.RSTEST_MEMORY_AWARE = '0';
      expect(createDefaultMemoryGate()).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.RSTEST_MEMORY_AWARE;
      else process.env.RSTEST_MEMORY_AWARE = prev;
    }
  });

  it('should return a MemoryGate instance otherwise', () => {
    const prev = process.env.RSTEST_MEMORY_AWARE;
    try {
      delete process.env.RSTEST_MEMORY_AWARE;
      const gate = createDefaultMemoryGate();
      expect(gate).toBeInstanceOf(MemoryGate);
    } finally {
      if (prev !== undefined) process.env.RSTEST_MEMORY_AWARE = prev;
    }
  });
});
