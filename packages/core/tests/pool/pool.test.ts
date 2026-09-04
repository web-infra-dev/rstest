import { resolve } from 'pathe';
import { MemoryGate } from '../../src/pool/memoryGate';
import { Pool } from '../../src/pool/pool';
import { composeSpawnEnv } from '../../src/pool/workers';
import { expectRejection } from './helpers';
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
  // Leave `memoryGate` unset so existing assertions around spawn
  // timing/order stay deterministic — the integration case below opts in
  // with its own fake.
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
  // A worker is only reused for tasks carrying the same key.
  environmentKey = 'node',
): PoolTask => ({
  worker: 'forks',
  type,
  options: {
    context: { runtimeConfig: { env: {} } },
    environmentKey,
    ...optionOverrides,
  } as any,
  rpcMethods: stubRpcMethods(),
});

describe('composeSpawnEnv', () => {
  it('combines the host env with only the task color env', () => {
    const envKeys = [
      'NODE_ENV',
      'FORCE_COLOR',
      'NO_COLOR',
      'RSTEST_HOST_ONLY_ENV',
      'RSTEST_PROJECT_ONLY_ENV',
    ] as const;
    const previousEnv = Object.fromEntries(
      envKeys.map((key) => [key, process.env[key]]),
    );

    try {
      process.env.NODE_ENV = 'host';
      process.env.FORCE_COLOR = '0';
      process.env.NO_COLOR = '1';
      process.env.RSTEST_HOST_ONLY_ENV = 'host-value';

      const task = createTask('run', {
        context: {
          runtimeConfig: {
            env: {
              NODE_ENV: 'project',
              FORCE_COLOR: '1',
              NO_COLOR: undefined,
              RSTEST_PROJECT_ONLY_ENV: 'project-value',
            },
          },
        },
      });
      const spawnEnv = composeSpawnEnv(task);

      expect(spawnEnv.NODE_ENV).toBe('host');
      expect(spawnEnv.RSTEST_HOST_ONLY_ENV).toBe('host-value');
      expect(spawnEnv.RSTEST_PROJECT_ONLY_ENV).toBeUndefined();
      expect(spawnEnv.FORCE_COLOR).toBe('1');
      expect(spawnEnv.NO_COLOR).toBeUndefined();
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
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

  it('preserves Buffer assets over advanced IPC', async () => {
    const pool = new Pool(createPoolOptions());
    try {
      const result = await pool.runTest(
        createTask('run', {
          __testMode: 'asset-transport',
          assets: {
            assetFiles: { '/asset.bin': Buffer.from([0, 0xff, 0x80, 0x41]) },
            sourceMaps: {},
          },
        }),
      );
      expect((result as any)._assetConstructor).toBe('Buffer');
      expect((result as any)._assetBytes).toEqual([0, 0xff, 0x80, 0x41]);
    } finally {
      await pool.close();
    }
  });
});

describe('Pool - environment prebundle fallback', () => {
  it('reports the same fallback only once across isolated workers', async () => {
    const onTestEnvironmentFallback = rs.fn();
    const pool = new Pool(
      createPoolOptions({ onTestEnvironmentFallback, maxWorkers: 1 }),
    );
    try {
      await pool.runTest(
        createTask('run', { __testMode: 'environment-fallback' }),
      );
      await pool.runTest(
        createTask('run', { __testMode: 'environment-fallback' }),
      );

      expect(onTestEnvironmentFallback).toHaveBeenCalledTimes(1);
      expect(onTestEnvironmentFallback).toHaveBeenCalledWith({
        packageName: 'happy-dom',
        bundlePath: '/tmp/happy-dom-bundle.mjs',
        resolvedPath: '/project/node_modules/happy-dom/cjs/index.cjs',
        reason: 'Error: Expected exports: GlobalWindow or Window.',
      });
    } finally {
      await pool.close();
    }
  });
});

describe('Pool - VM worker memory limit', () => {
  it('recycles a reusable worker after it reports heap over the limit', async () => {
    const pool = new Pool(
      createPoolOptions({
        isolate: false,
        maxWorkers: 1,
        minWorkers: 1,
        memoryLimit: 100,
      }),
    );
    try {
      const first = await pool.runTest(
        createTask('run', { __testMode: 'memory-over-limit' }),
      );
      const second = await pool.runTest(createTask());

      expect((first as any)._workerIdentity).toBeTypeOf('number');
      expect((second as any)._workerIdentity).toBeTypeOf('number');
      expect((second as any)._workerIdentity).not.toBe(
        (first as any)._workerIdentity,
      );
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
      const err = await expectRejection(
        pool.runTest(createTask('run', { __testMode: 'stderr-crash' })),
      );
      expect(err.message).toContain('segfault at 0x0');
    } finally {
      await pool.close();
    }
  });
});

// ── stderr handling ───────────────────────────────────────────────────────

describe('Pool - stderr handling', () => {
  it('should truncate large stderr in error messages', async () => {
    const pool = new Pool(createPoolOptions());
    try {
      const err = await expectRejection(
        pool.runTest(createTask('run', { __testMode: 'stderr-large' })),
      );
      expect(err.message).toContain('[truncated');
      expect(err.message).toContain('bytes of stderr]');
      // Tail is preserved
      expect(err.message).toContain('STDERR_TAIL_MARKER');
      // Total message should be bounded
      expect(Buffer.byteLength(err.message)).toBeLessThan(200 * 1024);
    } finally {
      await pool.close();
    }
  });

  it('should capture stderr written immediately before exit', async () => {
    const pool = new Pool(createPoolOptions());
    try {
      const err = await expectRejection(
        pool.runTest(createTask('run', { __testMode: 'stderr-late' })),
      );
      expect(err.message).toContain('late-stderr-marker');
    } finally {
      await pool.close();
    }
  });
});

// ── isolate behavior ───────────────────────────────────────────────────────

describe('Pool - isolate', () => {
  it('should use distinct PIDs when isolate is true', async () => {
    const pool = new Pool(createPoolOptions({ isolate: true }));
    try {
      const r1 = await pool.runTest(createTask());
      const r2 = await pool.runTest(createTask());
      const pid1 = (r1 as any)._workerIdentity;
      const pid2 = (r2 as any)._workerIdentity;
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
      expect((r1 as any)._workerIdentity).toBeTypeOf('number');
      expect((r1 as any)._workerIdentity).toBe((r2 as any)._workerIdentity);
      // Incrementing run count proves the same process instance handled
      // both tasks — not just a recycled PID.
      expect((r1 as any)._runCount).toBe((r2 as any)._runCount - 1);
    } finally {
      await pool.close();
    }
  });

  it('should not reuse a worker for a different test environment', async () => {
    const pool = new Pool(createPoolOptions({ isolate: false, minWorkers: 1 }));
    try {
      // A worker keeps its environment alive across files under
      // `isolate: false`, so reuse must be environment-matched — otherwise a
      // persisted module's evaluation-time DOM captures would dangle on the
      // previous environment (rstest#767).
      const jsdom = await pool.runTest(createTask('run', undefined, 'jsdom'));
      const node = await pool.runTest(createTask());
      expect((jsdom as any)._workerIdentity).not.toBe(
        (node as any)._workerIdentity,
      );

      // Same environment still reuses — affinity must not disable sharing.
      const nodeAgain = await pool.runTest(createTask());
      expect((nodeAgain as any)._workerIdentity).toBe(
        (node as any)._workerIdentity,
      );
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

  it('should drain cleanup errors from retired reusable workers', async () => {
    const pool = new Pool(createPoolOptions({ isolate: false, minWorkers: 0 }));
    try {
      await pool.runTest(createTask('run', { __testMode: 'cleanup-error' }));
      await expect(pool.drainWorkerStopErrors()).resolves.toEqual([
        expect.objectContaining({
          message: 'intentional worker cleanup failure',
        }),
      ]);
    } finally {
      await pool.close();
    }
  });
});

// ── memory gate integration ────────────────────────────────────────────────

describe('Pool - memory gate', () => {
  it('should park spawns when the gate blocks and resume when it unblocks', async () => {
    let allowSpawn = false;
    const gate = new MemoryGate();
    // Fake: first worker always allowed (deadlock guard); subsequent
    // fresh spawns only when `allowSpawn` flips true.
    const spy = rs
      .spyOn(gate, 'canSpawnNewWorker')
      .mockImplementation((active: number) =>
        active === 0 ? true : allowSpawn,
      );

    const pool = new Pool(
      createPoolOptions({ maxWorkers: 4, isolate: true, memoryGate: gate }),
    );

    try {
      const r1 = pool.runTest(createTask());
      const r2 = pool.runTest(createTask());

      // Wait until the gate has rejected at least once (proves r2 parked).
      while (!spy.mock.calls.some(([n]) => (n as number) > 0)) {
        await new Promise((r) => setImmediate(r));
      }
      allowSpawn = true;

      const [res1, res2] = await Promise.all([r1, r2]);
      expect(res1.status).toBe('pass');
      expect(res2.status).toBe('pass');
    } finally {
      await pool.close();
    }
  });
});

// ── exit-based lifecycle (not close) ────────────────────────────────────────

describe('Pool - exit-based lifecycle (not close)', () => {
  it('should reclaim worker slot on exit, not blocked by grandchild holding stdio', async () => {
    const pool = new Pool(createPoolOptions({ maxWorkers: 1, isolate: true }));
    const grandchildPidList: number[] = [];
    try {
      // Task 1: worker spawns a 30s grandchild that inherits stdout/stderr,
      // then sends its result and exits. With a `close`-based lifecycle this
      // would block slot reclaim until the grandchild exits (30s), causing
      // task 2 to hang.
      const start = Date.now();
      const r1 = await pool.runTest(
        createTask('run', { __testMode: 'spawn-orphan' }),
      );
      if ((r1 as any)._grandchildPid) {
        grandchildPidList.push((r1 as any)._grandchildPid);
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
      for (const pid of grandchildPidList) {
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

// ── close() behavior ──────────────────────────────────────────────────────

describe('Pool - close()', () => {
  it('should reject subsequent submissions after close()', async () => {
    const pool = new Pool(createPoolOptions());
    await pool.close();
    await expect(pool.runTest(createTask())).rejects.toThrow(/closed/);
  });

  // Regression: rstest#1275. The host owns worker termination via SIGTERM
  // and does not wait for any IPC ack. Previously the host waited the full
  // 60s WORKER_STOP_TIMEOUT_MS plus a 5s SIGKILL escalation for workers
  // that couldn't self-exit (e.g. rspack tokio threads ref'ing the loop),
  // producing the 60–65s hang reported in the issue.
  it('should close promptly under the forks pool (rstest#1275)', async () => {
    const pool = new Pool(createPoolOptions({ isolate: false, minWorkers: 1 }));
    await pool.runTest(createTask()); // warm up: worker is now alive and idle

    const start = Date.now();
    await pool.close();
    const elapsed = Date.now() - start;

    // Idle close should be SIGTERM-fast (sub-second). Allow generous CI
    // headroom but require it to be well below the 60s graceful budget.
    expect(elapsed).toBeLessThan(5000);
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

    // Concurrency can only increase when a task starts, so sampling every
    // start proves the upper bound without combining overlaps from
    // different moments in the sampled task's lifetime.
    for (const point of intervals) {
      const concurrent = intervals.filter(
        (iv) => iv.start <= point.start && iv.end > point.start,
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
      expect(sorted[i]!.start).toBeGreaterThanOrEqual(firstBatchEarliestEnd);
    }

    await pool.close();
  });
});

// ── worker-id slot semantics (rstest#1273) ──────────────────────────────────

describe('Pool - worker-id slot', () => {
  it('should keep RSTEST_WORKER_ID bounded by maxWorkers under isolate=true', async () => {
    const maxWorkers = 2;
    const taskCount = 6;
    const pool = new Pool(createPoolOptions({ maxWorkers, isolate: true }));

    try {
      const ids: number[] = [];
      for (let i = 0; i < taskCount; i++) {
        const result = await pool.runTest(createTask());
        ids.push((result as any)._workerId as number);
      }

      expect(ids).toHaveLength(taskCount);
      for (const id of ids) {
        expect(id).toBeGreaterThanOrEqual(1);
        expect(id).toBeLessThanOrEqual(maxWorkers);
      }
    } finally {
      await pool.close();
    }
  });

  it('should assign distinct ids to concurrent workers within [1, maxWorkers]', async () => {
    const maxWorkers = 3;
    const pool = new Pool(createPoolOptions({ maxWorkers, isolate: true }));

    try {
      const results = await Promise.all(
        Array.from({ length: maxWorkers }, () =>
          pool.runTest(
            createTask('run', { __testMode: 'slow', __delayMs: 100 }),
          ),
        ),
      );
      const ids = results.map((r) => (r as any)._workerId as number);
      // All concurrent workers alive at the same time must have distinct ids.
      expect(new Set(ids).size).toBe(maxWorkers);
      // And those ids exactly fill [1, maxWorkers].
      expect([...ids].sort()).toEqual([1, 2, 3]);
    } finally {
      await pool.close();
    }
  });

  it('should keep RSTEST_WORKER_ID stable across reuses under isolate=false', async () => {
    const pool = new Pool(createPoolOptions({ isolate: false, minWorkers: 1 }));
    try {
      const r1 = await pool.runTest(createTask());
      const r2 = await pool.runTest(createTask());
      const r3 = await pool.runTest(createTask());
      // Same process → same workerId across all reuses.
      expect((r1 as any)._workerIdentity).toBe((r2 as any)._workerIdentity);
      expect((r1 as any)._workerId).toBe((r2 as any)._workerId);
      expect((r1 as any)._workerId).toBe((r3 as any)._workerId);
    } finally {
      await pool.close();
    }
  });

  it('should reset worker-id allocator per Pool instance', async () => {
    const maxWorkers = 2;
    const poolA = new Pool(createPoolOptions({ maxWorkers, isolate: true }));
    const r1 = await poolA.runTest(createTask());
    await poolA.close();

    const poolB = new Pool(createPoolOptions({ maxWorkers, isolate: true }));
    try {
      const r2 = await poolB.runTest(createTask());
      // A fresh Pool restarts the allocator at 1 — there is no cross-pool
      // module-level counter (rstest#1273 regression).
      expect((r1 as any)._workerId).toBe(1);
      expect((r2 as any)._workerId).toBe(1);
    } finally {
      await poolB.close();
    }
  });
});
