import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import { Rstest } from '../../src/core/rstest';
import {
  createWatchCycleDriver,
  createWatchShortcutHandlers,
  createWatchTeardown,
} from '../../src/core/watchSession';
import type {
  ExecutorCycleOutcome,
  ExecutorRunCycleOptions,
  TestExecutor,
} from '../../src/types';
import type { TraceController, TraceRun } from '../../src/utils';

const rootPath = join(__dirname, 'fixtures/watch-session');

const emptyOutcome = (): ExecutorCycleOutcome => ({
  results: [],
  testResults: [],
  errors: [],
  testPaths: [],
  duration: { buildTime: 0, testTime: 0 },
});

const createContext = (): Rstest => {
  const context = new Rstest(
    {
      cwd: rootPath,
      command: 'watch',
      projects: [{ config: { root: rootPath, name: 'node-a' } }],
    },
    {},
  );
  // An embedded host owns the process lifecycle, so nothing here registers
  // fatal-signal handlers that would outlive the test worker.
  context.embedded = true;
  context.reporters = [];
  return context;
};

const createFakeExecutor = (
  name: string,
  onCycle?: (options: ExecutorRunCycleOptions) => void | Promise<void>,
): TestExecutor & { cycles: ExecutorRunCycleOptions[] } => {
  const cycles: ExecutorRunCycleOptions[] = [];
  return {
    name,
    projects: [],
    cycles,
    init: async () => {},
    close: async () => {},
    runCycle: async (options) => {
      cycles.push(options);
      await onCycle?.(options);
      return emptyOutcome();
    },
  };
};

/**
 * An executor whose first cycle parks until released, so a test can put further
 * triggers on either side of the moment that cycle reads its scope — which is
 * what decides whether they fold into the queued cycle or queue behind it.
 */
const createGatedExecutor = (name: string) => {
  let release: () => void = () => {};
  const parked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const executor = createFakeExecutor(name, async () => {
    if (executor.cycles.length === 1) {
      await parked;
    }
  });
  const started = async (): Promise<void> => {
    for (let i = 0; i < 100 && executor.cycles.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  return { executor, release: () => release(), started };
};

const createDriver = (context: Rstest) => {
  const runs: TraceRun[] = [];
  let activeTraceRun = { finalize: async () => {} } as TraceRun;
  const traceController = {
    beginRun: () => {
      const run = { finalize: async () => {} } as TraceRun;
      runs.push(run);
      return run;
    },
    close: async () => {},
  } as unknown as TraceController;

  return {
    runs,
    driver: createWatchCycleDriver({
      context,
      coverageProvider: null,
      traceController,
      getTraceRun: () => activeTraceRun,
      setTraceRun: (run) => {
        activeTraceRun = run;
      },
      enableCliShortcuts: false,
    }),
  };
};

describe('createWatchCycleDriver', () => {
  it('keeps the snapshot summary on an executor’s first cycle and clears it after', async () => {
    const context = createContext();
    const { driver } = createDriver(context);
    const seen: number[] = [];
    const executor = createFakeExecutor('node', () => {
      seen.push(context.snapshotManager.summary.unmatched);
    });

    context.snapshotManager.summary.unmatched = 3;
    await driver.runCycle(executor, { mode: 'all' });

    context.snapshotManager.summary.unmatched = 5;
    await driver.runCycle(executor, { mode: 'on-demand' });

    // First cycle sees the value untouched; the rerun sees a cleared summary.
    expect(seen).toEqual([3, 0]);
  });

  it('clears the failed-test count even on a first cycle, so bail stays cycle-scoped', async () => {
    // The other half of the mixed-watch startup order: the browser's first
    // cycle must not inherit the node initial cycle's failures, or a `bail`
    // limit already reached drains every browser file as skipped before the
    // browser session has run a test.
    const context = createContext();
    const { driver } = createDriver(context);
    const node = createFakeExecutor('node', () => {
      context.stateManager.onTestFileResult({
        testId: '/fail.test.ts',
        name: '/fail.test.ts',
        status: 'fail',
        testPath: '/fail.test.ts',
        project: 'node-a',
        results: [],
      });
    });
    const seen: number[] = [];
    const browser = createFakeExecutor('browser', () => {
      seen.push(context.stateManager.getCountOfFailedTests());
    });

    await driver.runCycle(node, { mode: 'all' });
    expect(context.stateManager.getCountOfFailedTests()).toBe(1);

    await driver.runCycle(browser, { mode: 'all' });

    expect(seen).toEqual([0]);
  });

  it('does not let one executor’s first cycle clear another’s summary', async () => {
    // The mixed-watch startup order: the node initial cycle finalizes, then the
    // browser initial cycle runs. `u` reads the summary the node cycle left.
    const context = createContext();
    const { driver } = createDriver(context);
    const node = createFakeExecutor('node');
    const browser = createFakeExecutor('browser');

    await driver.runCycle(node, { mode: 'all' });
    context.snapshotManager.summary.unmatched = 2;
    await driver.runCycle(browser, { mode: 'all' });

    expect(context.snapshotManager.summary.unmatched).toBe(2);
  });

  it('folds a burst of invalidations into the queued cycle instead of appending', async () => {
    const context = createContext();
    const { driver } = createDriver(context);
    const { executor, release, started } = createGatedExecutor('browser');

    const inFlight = driver.runCycle(executor, {
      mode: 'on-demand',
      fileFilters: ['/a.test.ts'],
      fromInvalidation: true,
    });
    await started();

    // Both land while the first cycle is running, so they share one queued
    // cycle rather than each running the same files over again.
    const burstA = driver.runCycle(executor, {
      mode: 'on-demand',
      fileFilters: ['/b.test.ts'],
      fromInvalidation: true,
    });
    const burstB = driver.runCycle(executor, {
      mode: 'on-demand',
      fileFilters: ['/c.test.ts'],
      fromInvalidation: true,
    });
    // A second signal for a file already in the queued scope adds nothing: it
    // is the same cycle that will run it, which is what lets the headed host
    // hand that cycle a per-file test-name pattern.
    const burstC = driver.runCycle(executor, {
      mode: 'on-demand',
      fileFilters: ['/b.test.ts'],
      fromInvalidation: true,
    });
    expect(burstA).toBe(burstB);
    expect(burstA).toBe(burstC);

    release();
    await Promise.all([inFlight, burstA, burstB, burstC]);

    expect(executor.cycles).toHaveLength(2);
    // The union, not the last one in: neither trigger's file is dropped.
    expect(executor.cycles[1]!.fileFilters?.slice().sort()).toEqual([
      '/b.test.ts',
      '/c.test.ts',
    ]);
  });

  it('never folds an explicit trigger together with an invalidation', async () => {
    const context = createContext();
    const { driver } = createDriver(context);
    const { executor, release, started } = createGatedExecutor('node');

    const inFlight = driver.runCycle(executor, { mode: 'all' });
    await started();

    // A rebuild, then the `p` shortcut's scoped cycle, then another rebuild.
    const rebuild = driver.runCycle(executor, {
      mode: 'on-demand',
      fromInvalidation: true,
    });
    const scoped = driver.runCycle(executor, { fileFilters: ['/a.test.ts'] });
    const laterRebuild = driver.runCycle(executor, {
      mode: 'on-demand',
      fromInvalidation: true,
    });

    release();
    await Promise.all([inFlight, rebuild, scoped, laterRebuild]);

    // Each cycle runs exactly the scope its own trigger asked for. A merge
    // would either hand the shortcut's file list to a rebuild, or replace the
    // list the shortcut chose with the rebuild's cycle-time scope.
    expect(
      executor.cycles.map((cycle) => [cycle.mode, cycle.fileFilters]),
    ).toEqual([
      ['all', undefined],
      ['on-demand', undefined],
      ['all', ['/a.test.ts']],
      ['on-demand', undefined],
    ]);
  });

  it('keeps a snapshot update inside the files its own trigger chose', async () => {
    // The `u` shortcut flips `updateSnapshot` for the cycles it asks for and
    // holds it flipped until they finish. Nothing it did not ask for may run
    // under that flag: rewriting every snapshot file a rebuild happened to
    // touch destroys data the user never offered up.
    const context = createContext();
    const { driver } = createDriver(context);
    const { executor, release, started } = createGatedExecutor('node');
    const originalUpdateSnapshot =
      context.snapshotManager.options.updateSnapshot;

    const inFlight = driver.runCycle(executor, { mode: 'all' });
    await started();

    // A save lands while the first cycle runs, queueing a rebuild cycle...
    const rebuild = driver.runCycle(executor, {
      mode: 'on-demand',
      fromInvalidation: true,
    });
    // ...and then the user presses `u`.
    context.snapshotManager.options.updateSnapshot = 'all';
    const update = driver.runCycle(executor, {
      fileFilters: ['/snap.test.ts'],
    });

    release();
    try {
      await Promise.all([inFlight, rebuild, update]);
    } finally {
      context.snapshotManager.options.updateSnapshot = originalUpdateSnapshot;
    }

    expect(executor.cycles).toHaveLength(3);
    // The rebuild keeps the flag as it stood when its own trigger queued it,
    // even though it was dispatched inside the `u` window.
    expect(executor.cycles[1]).toMatchObject({
      updateSnapshot: originalUpdateSnapshot,
      fileFilters: undefined,
    });
    expect(executor.cycles[2]).toMatchObject({
      updateSnapshot: 'all',
      fileFilters: ['/snap.test.ts'],
    });
  });

  it('queues rather than folds once the cycle has read its scope', async () => {
    const context = createContext();
    const { driver } = createDriver(context);
    const { executor, release, started } = createGatedExecutor('node');

    const inFlight = driver.runCycle(executor, {
      mode: 'on-demand',
      fileFilters: ['/a.test.ts'],
      fromInvalidation: true,
    });
    await started();

    // The running cycle has already read its scope, so this signal cannot fold
    // into it — it has to run on its own.
    const next = driver.runCycle(executor, {
      mode: 'on-demand',
      fileFilters: ['/b.test.ts'],
      fromInvalidation: true,
    });
    expect(next).not.toBe(inFlight);

    release();
    await Promise.all([inFlight, next]);

    expect(executor.cycles.map((cycle) => cycle.fileFilters)).toEqual([
      ['/a.test.ts'],
      ['/b.test.ts'],
    ]);
  });

  it('keeps a rejected cycle from wedging the queue', async () => {
    const context = createContext();
    const { driver } = createDriver(context);
    const executor = createFakeExecutor('node', (options) => {
      if (options.mode === 'on-demand') {
        throw new Error('cycle blew up');
      }
    });

    await driver.runCycle(executor, { mode: 'all' });
    await expect(
      driver.runCycle(executor, { mode: 'on-demand' }),
    ).rejects.toThrow('cycle blew up');

    // The next trigger still runs.
    await driver.runCycle(executor, { mode: 'all' });
    expect(executor.cycles).toHaveLength(3);
  });

  it('arms a shortcut only once every executor it reaches has finalized', async () => {
    // Mixed watch starts the node side first, so its cycle finalizes while the
    // browser host is still booting the runtime its rerun requests need. A
    // single driver-wide flag reads as armed there, and the `a`/`f`/`u` fanout
    // then reruns the node side and drops the browser half in silence.
    const context = createContext();
    const { driver } = createDriver(context);
    const node = createFakeExecutor('node');
    const browser = createFakeExecutor('browser');

    await driver.runCycle(node, { mode: 'all' });

    expect(driver.hasFinalizedCycle([node])).toBe(true);
    expect(driver.hasFinalizedCycle([node, browser])).toBe(false);

    await driver.runCycle(browser, { mode: 'all' });

    expect(driver.hasFinalizedCycle([node, browser])).toBe(true);
  });

  it('rotates one trace buffer per finalized cycle', async () => {
    const context = createContext();
    const { runs, driver } = createDriver(context);
    const executor = createFakeExecutor('node');

    await driver.runCycle(executor, { mode: 'all' });
    await driver.runCycle(executor, { mode: 'on-demand' });

    expect(runs).toHaveLength(2);
  });
});

describe('createWatchTeardown', () => {
  const noopTrace = () =>
    ({
      finalize: async () => {},
    }) as TraceRun;

  it('closes every executor and finalizes the trace even when one close throws', async () => {
    const closed: string[] = [];
    let traceFinalized = 0;
    let controllerClosed = 0;

    const close = createWatchTeardown({
      executors: [
        {
          ...createFakeExecutor('browser'),
          close: async () => {
            closed.push('browser');
            throw new Error('browser close failed');
          },
        },
        {
          ...createFakeExecutor('node'),
          close: async () => {
            closed.push('node');
          },
        },
      ],
      traceController: {
        beginRun: noopTrace,
        close: async () => {
          controllerClosed += 1;
        },
      } as unknown as TraceController,
      getTraceRun: () =>
        ({
          finalize: async () => {
            traceFinalized += 1;
          },
        }) as TraceRun,
    });

    await close();

    // A throwing close must not take the executors behind it, or the trace
    // files, down with it — teardown is the last thing that runs.
    expect(closed).toEqual(['browser', 'node']);
    expect(traceFinalized).toBe(1);
    expect(controllerClosed).toBe(1);
  });

  it('runs the teardown once for repeated calls', async () => {
    let closes = 0;
    const close = createWatchTeardown({
      executors: [
        {
          ...createFakeExecutor('node'),
          close: async () => {
            closes += 1;
          },
        },
      ],
      traceController: {
        beginRun: noopTrace,
        close: async () => {},
      } as unknown as TraceController,
      getTraceRun: noopTrace,
    });

    await Promise.all([close(), close()]);
    await close();

    expect(closes).toBe(1);
  });
});

describe('createWatchShortcutHandlers arming', () => {
  const targetsOf = (cycles: string[]) => ({
    node: {
      runCycle: async () => {
        cycles.push('node');
      },
      globTestEntries: async () => ['/a.test.ts'],
    },
    browser: {
      rerun: async () => {
        cycles.push('browser');
      },
    },
  });

  it('drops rerun keys until a cycle has finalized, then honors them', async () => {
    // Shortcuts install before the first cycle so the ready banner always has a
    // stdin owner. An `a` in that window would start the node dev server through
    // its own cycle and leave the first compile to enqueue a second startup run,
    // while the browser side has no watch session to answer at all.
    const cycles: string[] = [];
    let armed = false;
    const handlers = createWatchShortcutHandlers(
      createContext(),
      targetsOf(cycles),
      async () => {},
      () => armed,
    );

    await handlers.runAll!();
    expect(cycles).toEqual([]);

    armed = true;
    await handlers.runAll!();
    expect(cycles).toEqual(['node', 'browser']);
  });

  it('offers the same gate to the stdin owner, so a gated prompt never opens', () => {
    // `t`/`p` ask for input before they call their handler. A gate that only
    // wraps the handler lets the prompt open, take a pattern, and throw it away
    // on Enter — or, on Escape, drop the keystroke without a word.
    let armed = false;
    const handlers = createWatchShortcutHandlers(
      createContext(),
      targetsOf([]),
      async () => {},
      () => armed,
    );

    expect(handlers.canRerun!()).toBe(false);

    armed = true;
    expect(handlers.canRerun!()).toBe(true);
  });

  it('leaves the quit handler reachable before the first cycle', async () => {
    let closed = 0;
    const handlers = createWatchShortcutHandlers(
      createContext(),
      targetsOf([]),
      async () => {
        closed += 1;
      },
      () => false,
    );

    await handlers.closeServer!();

    expect(closed).toBe(1);
  });
});
