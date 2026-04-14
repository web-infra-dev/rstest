import { resolve } from 'pathe';
import { Pool } from '../../src/pool/pool';
import type { PoolOptions, PoolTask } from '../../src/pool/types';

const WORKER_ENTRY = resolve(__dirname, './fixtures/testWorker.mjs');

const createPoolOptions = (overrides?: Partial<PoolOptions>): PoolOptions => ({
  workerEntry: WORKER_ENTRY,
  maxWorkers: 2,
  minWorkers: 0,
  isolate: true,
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
  worker: 'forks',
  type,
  options: {
    ...optionOverrides,
  } as any,
  rpcMethods: stubRpcMethods(),
});

// ── basic run ───────────────────────────────────────────────────────────────

describe('Pool - basic', () => {
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

describe('Pool - fatal error', () => {
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

// ── isolate behaviour ───────────────────────────────────────────────────────

describe('Pool - isolate', () => {
  it('should use distinct PIDs when isolate is true', async () => {
    const pool = new Pool(createPoolOptions({ isolate: true }));
    try {
      const r1 = await pool.runTest(createTask());
      const r2 = await pool.runTest(createTask());
      const pid1 = (r1 as any)._workerPid;
      const pid2 = (r2 as any)._workerPid;
      expect(pid1).toBeTypeOf('number');
      expect(pid2).toBeTypeOf('number');
      expect(pid1).not.toBe(pid2);
    } finally {
      await pool.close();
    }
  });

  it('should dispatch multiple tasks to the same process when isolate is false', async () => {
    const pool = new Pool(createPoolOptions({ isolate: false, minWorkers: 1 }));
    try {
      const r1 = await pool.runTest(createTask());
      const r2 = await pool.runTest(createTask());
      // Same PID proves process reuse.
      expect((r1 as any)._workerPid).toBeTypeOf('number');
      expect((r1 as any)._workerPid).toBe((r2 as any)._workerPid);
      // Incrementing run count proves the same process instance handled
      // both tasks — not just a recycled PID.
      expect((r1 as any)._runCount).toBe((r2 as any)._runCount - 1);
    } finally {
      await pool.close();
    }
  });

  it('should replace a crashed reusable worker instead of reusing or deadlocking', async () => {
    const pool = new Pool(createPoolOptions({ isolate: false, minWorkers: 1 }));
    try {
      // Crash the reusable worker via fatal_error — this sets
      // PoolRunner.crashed=true so isUsable() returns false.
      await expect(
        pool.runTest(createTask('run', { __testMode: 'fatal' })),
      ).rejects.toThrow('intentional crash');

      // The pool must discard the poisoned runner and spin up a fresh
      // worker. If releaseRunner/acquireRunner recycled the crashed
      // runner, this would hang or throw an IPC error.
      const result = await pool.runTest(createTask());
      expect(result.status).toBe('pass');
    } finally {
      await pool.close();
    }
  });
});

// ── exit-based lifecycle (not close) ────────────────────────────────────────

describe('Pool - exit-based lifecycle (not close)', () => {
  it('should reclaim worker slot on exit, not blocked by grandchild holding stdio', async () => {
    const pool = new Pool(createPoolOptions({ maxWorkers: 1, isolate: true }));
    const grandchildPids: number[] = [];
    try {
      // Task 1: worker spawns a 30s grandchild that inherits stdout/stderr,
      // then sends its result and exits. With a `close`-based lifecycle this
      // would block slot reclaim until the grandchild exits (30s), causing
      // task 2 to hang until WORKER_STOP_TIMEOUT_MS.
      const start = Date.now();
      const r1 = await pool.runTest(
        createTask('run', { __testMode: 'spawn-orphan' }),
      );
      if ((r1 as any)._grandchildPid) {
        grandchildPids.push((r1 as any)._grandchildPid);
      }

      // Task 2: must start promptly after task 1's worker exits, not after
      // the grandchild from task 1 exits. maxWorkers=1 means this task is
      // gated on the previous slot being freed.
      const r2 = await pool.runTest(createTask());
      const elapsed = Date.now() - start;

      expect(r1.status).toBe('pass');
      expect(r2.status).toBe('pass');
      // If slot reclaim were stuck on `close`, elapsed would be >= 30s.
      // With `exit`-based reclaim it should be well under 5s.
      expect(elapsed).toBeLessThan(5000);
    } finally {
      await pool.close();
      // Clean up orphaned grandchildren.
      for (const pid of grandchildPids) {
        try {
          process.kill(pid);
        } catch {
          // already gone
        }
      }
    }
  });
});

// ── worker failure recovery ────────────────────────────────────────────────

describe('Pool - failure recovery', () => {
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
      // Crash the first worker — the slot must be freed on exit.
      await expect(
        pool.runTest(createTask('run', { __testMode: 'exit-silent' })),
      ).rejects.toThrow();
      // With maxWorkers=1, this task would deadlock if the crashed slot
      // was not released. A successful result proves scheduler recovery.
      const result = await pool.runTest(createTask());
      expect(result.status).toBe('pass');
    } finally {
      await pool.close();
    }
  });
});

// ── close() behaviour ──────────────────────────────────────────────────────

describe('Pool - close()', () => {
  it('should not drop in-flight task result', async () => {
    const pool = new Pool(createPoolOptions());
    const taskPromise = pool.runTest(
      createTask('run', { __testMode: 'slow', __delayMs: 200 }),
    );
    // Give the worker time to start, then close the pool.
    await new Promise((r) => setTimeout(r, 50));
    const closePromise = pool.close();
    // The task should still resolve (worker sends result before stopping).
    const result = await taskPromise;
    expect(result.status).toBe('pass');
    await closePromise;
  });

  it('should reject subsequent submissions after close()', async () => {
    const pool = new Pool(createPoolOptions());
    await pool.close();
    await expect(pool.runTest(createTask())).rejects.toThrow(/closed/);
  });
});

// ── maxWorkers capacity ─────────────────────────────────────────────────────

describe('Pool - capacity', () => {
  it('should never run more than maxWorkers tasks concurrently', async () => {
    const maxWorkers = 2;
    const delayMs = 200;
    const taskCount = 4;
    const pool = new Pool(createPoolOptions({ maxWorkers, isolate: true }));

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

    // Each slow-mode result carries _startedAt / _finishedAt timestamps
    // from the worker process.
    const intervals = results.map((r) => ({
      start: (r as any)._startedAt as number,
      end: (r as any)._finishedAt as number,
    }));

    for (const iv of intervals) {
      expect(iv.start).toBeTypeOf('number');
      expect(iv.end).toBeTypeOf('number');
    }

    // Upper bound: at no point were more than maxWorkers tasks running.
    for (const point of intervals) {
      const concurrent = intervals.filter(
        (iv) => iv.start < point.end && iv.end > point.start,
      ).length;
      expect(concurrent).toBeLessThanOrEqual(maxWorkers);
    }

    // Queuing proof: with taskCount > maxWorkers, excess tasks must have
    // waited for a slot. The (maxWorkers+1)th task (by start time) must
    // have started no earlier than the first slot freed up.
    const sorted = [...intervals].sort((a, b) => a.start - b.start);
    const firstBatchEarliestEnd = Math.min(
      ...sorted.slice(0, maxWorkers).map((iv) => iv.end),
    );
    for (let i = maxWorkers; i < sorted.length; i++) {
      expect(sorted[i].start).toBeGreaterThanOrEqual(firstBatchEarliestEnd);
    }

    await pool.close();
  });
});
