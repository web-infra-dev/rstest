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
 * what decides whether they coalesce into the queued cycle or queue behind it.
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
  it('skips the state reset on an executor’s first cycle and applies it after', async () => {
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

  it('coalesces a burst of triggers into the queued cycle instead of appending', async () => {
    const context = createContext();
    const { driver } = createDriver(context);
    const { executor, release, started } = createGatedExecutor('browser');

    const inFlight = driver.runCycle(executor, {
      mode: 'on-demand',
      fileFilters: ['/a.test.ts'],
    });
    await started();

    // Both land while the first cycle is running, so they share one queued
    // cycle rather than each running the same files over again.
    const burstA = driver.runCycle(executor, {
      mode: 'on-demand',
      fileFilters: ['/b.test.ts'],
    });
    const burstB = driver.runCycle(executor, {
      mode: 'on-demand',
      fileFilters: ['/c.test.ts'],
    });
    expect(burstA).toBe(burstB);

    release();
    await Promise.all([inFlight, burstA, burstB]);

    expect(executor.cycles).toHaveLength(2);
    // Widened, not replaced: neither trigger's file is dropped.
    expect(executor.cycles[1]!.fileFilters?.slice().sort()).toEqual([
      '/b.test.ts',
      '/c.test.ts',
    ]);
  });

  it('widens a coalesced cycle to the broader scope', async () => {
    const context = createContext();
    const { driver } = createDriver(context);
    const { executor, release, started } = createGatedExecutor('node');

    const inFlight = driver.runCycle(executor, { mode: 'all' });
    await started();

    const scoped = driver.runCycle(executor, {
      mode: 'on-demand',
      fileFilters: ['/a.test.ts'],
    });
    const everything = driver.runCycle(executor, { mode: 'all' });

    release();
    await Promise.all([inFlight, scoped, everything]);

    expect(executor.cycles).toHaveLength(2);
    // `all` with no filters is broader than the scoped rerun it absorbed.
    expect(executor.cycles[1]).toMatchObject({ mode: 'all' });
    expect(executor.cycles[1]!.fileFilters).toBeUndefined();
  });

  it('queues rather than coalesces once the cycle has read its scope', async () => {
    const context = createContext();
    const { driver } = createDriver(context);
    const { executor, release, started } = createGatedExecutor('node');

    const inFlight = driver.runCycle(executor, {
      mode: 'on-demand',
      fileFilters: ['/a.test.ts'],
    });
    await started();

    // The running cycle has already read its scope, so this one cannot widen
    // it — it has to run on its own.
    const next = driver.runCycle(executor, {
      mode: 'on-demand',
      fileFilters: ['/b.test.ts'],
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
