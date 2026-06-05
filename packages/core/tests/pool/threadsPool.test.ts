import { resolve } from 'pathe';
import { Pool } from '../../src/pool/pool';
import type { PoolOptions, PoolTask } from '../../src/pool/types';

const WORKER_ENTRY = resolve(__dirname, './fixtures/testWorker.mjs');

const createPoolOptions = (overrides?: Partial<PoolOptions>): PoolOptions => ({
  workerEntry: WORKER_ENTRY,
  maxWorkers: 2,
  minWorkers: 0,
  isolate: true,
  // The fixture worker intentionally writes crash-like output to stderr
  // (e.g. `segfault at 0x0`, 100 KB of `x`) to exercise stderr capture and
  // truncation. Suppress host forwarding so this simulated noise doesn't
  // leak into the parent rstest log on CI.
  forwardStdio: false,
  ...overrides,
});

const stubRpcMethods = () =>
  ({
    onTestFileStart: async () => {},
    onTestFileReady: async () => {},
    onTestSuiteStart: async () => {},
    onTestSuiteResult: async () => {},
    onTestCaseStart: async () => {},
    onTestCaseResult: async () => {},
    getCountOfFailedTests: async () => 0,
    onConsoleLog: () => {},
    resolveSnapshotPath: (p: string) => p,
    getAssetsByEntry: async () => ({ assetFiles: {}, sourceMaps: {} }),
  }) as unknown as PoolTask['rpcMethods'];

const createTask = (
  type: PoolTask['type'] = 'run',
  optionOverrides?: Record<string, unknown>,
): PoolTask => ({
  worker: 'threads',
  type,
  options: {
    ...optionOverrides,
  } as any,
  rpcMethods: stubRpcMethods(),
});

// ── basic run ───────────────────────────────────────────────────────────────

describe('ThreadsPool - basic', () => {
  it('should run a task and return a result', async () => {
    const pool = new Pool(createPoolOptions());
    try {
      const result = await pool.runTest(createTask());
      expect(result.status).toBe('pass');
    } finally {
      await pool.close();
    }
  });

  it('should collect tests via the collect envelope', async () => {
    const pool = new Pool(createPoolOptions());
    try {
      const result = await pool.collectTests(createTask('collect'));
      expect(result.tests).toEqual([]);
      expect(result.testPath).toBeTypeOf('string');
    } finally {
      await pool.close();
    }
  });
});

// ── fatal_error attribution ─────────────────────────────────────────────────

describe('ThreadsPool - fatal error', () => {
  it('should reject with structured error when worker sends fatal_error', async () => {
    const pool = new Pool(createPoolOptions());
    try {
      await expect(
        pool.runTest(createTask('run', { __testMode: 'fatal' })),
      ).rejects.toThrow('intentional crash');
    } finally {
      await pool.close();
    }
  });

  it('should reject when worker exits without responding', async () => {
    const pool = new Pool(createPoolOptions());
    try {
      await expect(
        pool.runTest(createTask('run', { __testMode: 'exit-silent' })),
      ).rejects.toThrow(/Worker exited unexpectedly/);
    } finally {
      await pool.close();
    }
  });

  it('should enrich error with captured stderr when worker crashes', async () => {
    const pool = new Pool(createPoolOptions());
    try {
      const err: Error = await pool
        .runTest(createTask('run', { __testMode: 'stderr-crash' }))
        .catch((e: Error) => e);
      expect(err.message).toContain('segfault at 0x0');
    } finally {
      await pool.close();
    }
  });
});

// ── stderr handling ────────────────────────────────────────────────────────

describe('ThreadsPool - stderr handling', () => {
  it('should truncate large stderr in error messages', async () => {
    const pool = new Pool(createPoolOptions());
    try {
      const err: Error = await pool
        .runTest(createTask('run', { __testMode: 'stderr-large' }))
        .catch((e: Error) => e);
      expect(err.message).toContain('[truncated');
      expect(err.message).toContain('bytes of stderr]');
      expect(err.message).toContain('STDERR_TAIL_MARKER');
      expect(Buffer.byteLength(err.message)).toBeLessThan(200 * 1024);
    } finally {
      await pool.close();
    }
  });
});

// ── isolate behavior ───────────────────────────────────────────────────────

describe('ThreadsPool - isolate', () => {
  it('should use distinct worker identities when isolate is true', async () => {
    const pool = new Pool(createPoolOptions({ isolate: true }));
    try {
      const r1 = await pool.runTest(createTask());
      const r2 = await pool.runTest(createTask());
      const id1 = (r1 as any)._workerIdentity;
      const id2 = (r2 as any)._workerIdentity;
      expect(id1).toBeTypeOf('number');
      expect(id2).toBeTypeOf('number');
      // Threads share the parent PID; the fixture mixes in `threadId` so a
      // fresh worker yields a distinct identity even though the PID is
      // shared.
      expect(id1).not.toBe(id2);
    } finally {
      await pool.close();
    }
  });

  it('should dispatch multiple tasks to the same thread when isolate is false', async () => {
    const pool = new Pool(createPoolOptions({ isolate: false, minWorkers: 1 }));
    try {
      const r1 = await pool.runTest(createTask());
      const r2 = await pool.runTest(createTask());
      // Same identity proves thread reuse.
      expect((r1 as any)._workerIdentity).toBe((r2 as any)._workerIdentity);
      // Incrementing run count proves the same thread instance handled
      // both tasks — not coincidental identity collision.
      expect((r1 as any)._runCount).toBe((r2 as any)._runCount - 1);
    } finally {
      await pool.close();
    }
  });

  it('should replace a crashed reusable thread instead of reusing or deadlocking', async () => {
    const pool = new Pool(createPoolOptions({ isolate: false, minWorkers: 1 }));
    try {
      await expect(
        pool.runTest(createTask('run', { __testMode: 'fatal' })),
      ).rejects.toThrow('intentional crash');

      const result = await pool.runTest(createTask());
      expect(result.status).toBe('pass');
    } finally {
      await pool.close();
    }
  });
});

// ── worker failure recovery ────────────────────────────────────────────────

describe('ThreadsPool - failure recovery', () => {
  it('should reject when worker entry does not exist', async () => {
    const pool = new Pool(
      createPoolOptions({ workerEntry: '/nonexistent/worker.js' }),
    );
    try {
      await expect(pool.runTest(createTask())).rejects.toThrow();
    } finally {
      await pool.close();
    }
  });

  it('should release the slot after a worker crash and accept subsequent tasks', async () => {
    const pool = new Pool(createPoolOptions({ maxWorkers: 1 }));
    try {
      await expect(
        pool.runTest(createTask('run', { __testMode: 'exit-silent' })),
      ).rejects.toThrow();
      const result = await pool.runTest(createTask());
      expect(result.status).toBe('pass');
    } finally {
      await pool.close();
    }
  });
});

// ── close() behavior ──────────────────────────────────────────────────────

describe('ThreadsPool - close()', () => {
  it('should reject subsequent submissions after close()', async () => {
    const pool = new Pool(createPoolOptions());
    await pool.close();
    await expect(pool.runTest(createTask())).rejects.toThrow(/closed/);
  });
});

// ── maxWorkers capacity ─────────────────────────────────────────────────────

describe('ThreadsPool - capacity', () => {
  it('should never run more than maxWorkers tasks concurrently', async () => {
    const maxWorkers = 2;
    const delayMs = 200;
    const taskCount = 4;
    const pool = new Pool(createPoolOptions({ maxWorkers, isolate: true }));

    try {
      const results = await Promise.all(
        Array.from({ length: taskCount }, () =>
          pool.runTest(
            createTask('run', { __testMode: 'slow', __delayMs: delayMs }),
          ),
        ),
      );

      expect(results).toHaveLength(taskCount);
      for (const r of results) {
        expect(r.status).toBe('pass');
      }

      const intervals = results.map((r) => ({
        start: (r as any)._startedAt as number,
        end: (r as any)._finishedAt as number,
      }));

      // Upper bound: at no point were more than maxWorkers tasks running.
      for (const point of intervals) {
        const concurrent = intervals.filter(
          (iv) => iv.start < point.end && iv.end > point.start,
        ).length;
        expect(concurrent).toBeLessThanOrEqual(maxWorkers);
      }
    } finally {
      await pool.close();
    }
  });
});
