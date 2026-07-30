import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';
import { join } from 'pathe';
import type { BrowserRunPlanner } from '../../src/core/browser/runPlanner';
import { Rstest } from '../../src/core/rstest';
import { createTraceController } from '../../src/utils';
import { type RunTestsDeps, runTests } from '../../src/core/runTests';
import type {
  ExecutorCycleOutcome,
  ExecutorInvalidationCallback,
  ExecutorRunCycleOptions,
  ProjectContext,
  Reporter,
  TestExecutor,
  TestFileResult,
} from '../../src/types';

const rootPath = join(__dirname, '../..');

type RunEndPayload = Parameters<NonNullable<Reporter['onTestRunEnd']>>[0];

/**
 * Let the initial browser cycle — scheduled but deliberately not awaited by the
 * mixed watch path — settle before a test inspects the session.
 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 30));

const passingFile = (testPath: string, project: string): TestFileResult => ({
  testId: testPath,
  name: testPath,
  status: 'pass',
  testPath,
  project,
  results: [],
});

const outcomeOf = (results: TestFileResult[]): ExecutorCycleOutcome => ({
  results,
  testResults: [],
  errors: [],
  testPaths: results.map((result) => result.testPath),
  duration: { buildTime: 0, testTime: 0 },
});

type RunCycleImpl = (
  options: ExecutorRunCycleOptions,
) => Promise<ExecutorCycleOutcome>;

type FakeExecutor = TestExecutor & {
  cycles: ExecutorRunCycleOptions[];
  closeCount: number;
};

/**
 * A `TestExecutor` that records what the orchestrator asked of it. `events` is
 * shared across every collaborator of one run so ordering invariants (init
 * barrier, node resources before browser load, sibling cycles settling before
 * teardown, cycles never interleaving) can be asserted as a single sequence.
 */
const createFakeExecutor = (
  name: string,
  events: string[],
  runCycle: RunCycleImpl,
): FakeExecutor => {
  const fake: FakeExecutor = {
    name,
    projects: [],
    cycles: [],
    closeCount: 0,
    init: async () => {
      events.push(`${name}:init`);
    },
    runCycle: async (options) => {
      fake.cycles.push(options);
      events.push(`${name}:cycle-start`);
      const outcome = await runCycle(options);
      events.push(`${name}:cycle-end`);
      return outcome;
    },
    close: async () => {
      fake.closeCount += 1;
      events.push(`${name}:close`);
    },
  };
  return fake;
};

const createFakeNodeExecutor = ({
  events,
  hasNodeTestsToRun,
  runCycle = async () => outcomeOf([]),
  testEntries = [],
}: {
  events: string[];
  hasNodeTestsToRun: boolean;
  runCycle?: RunCycleImpl;
  /** What the `p` shortcut's re-glob returns. */
  testEntries?: string[];
}) => {
  let invalidateCallback: ExecutorInvalidationCallback | undefined;
  return Object.assign(createFakeExecutor('node', events, runCycle), {
    getPlan: () => ({
      projects: [],
      entriesCache: new Map(),
      browserProjectsToRun: [],
      nodeProjectsToRun: [],
    }),
    hasNodeTestsToRun: () => hasNodeTestsToRun,
    hasBrowserTestsToRun: () => false,
    coveragePluginLoadError: () => undefined,
    refreshPlan: async () => {},
    setCoverageProvider: () => {},
    ensureRunResources: async () => {
      events.push('node:ensure-run-resources');
    },
    globTestEntries: async () => testEntries,
    onInvalidate: (cb: ExecutorInvalidationCallback) => {
      invalidateCallback = cb;
    },
    /**
     * Stand in for a dev compile. The real executor awaits the callback inside
     * `onAfterDevCompile` — not to serialize cycles, which the driver's queue
     * does on its own, but because its cycle pulls the affected-entry diff from
     * the dev server and holding the hook is what pairs one pull with one
     * compile.
     */
    invalidate: async (isFirstBuild: boolean) => {
      await invalidateCallback!({ isFirstBuild });
    },
  });
};

/**
 * The browser side of the seam guarantees `collect` (`rstest list` uses it) and
 * the watch pair `onInvalidate`/`requestRerun`.
 */
const createFakeBrowserExecutor = (
  events: string[],
  runCycle: RunCycleImpl,
  hasWatchSession = true,
  /**
   * The paths this host would find in its own file set. `undefined` stands for
   * a host that owns whatever it is asked for.
   */
  ownedPaths?: string[],
) => {
  let invalidateCallback: ExecutorInvalidationCallback | undefined;
  return Object.assign(createFakeExecutor('browser', events, runCycle), {
    collect: async () => ({ list: [] }),
    hasWatchSession: () => hasWatchSession,
    onInvalidate: (cb: ExecutorInvalidationCallback) => {
      invalidateCallback = cb;
    },
    /**
     * The host resolves the requested scope against its own file set and only
     * then signals; a request matching nothing produces no cycle at all.
     */
    requestRerun: async (testPaths?: string[]) => {
      events.push(`browser:request-rerun:${testPaths?.join(',') ?? 'all'}`);
      if (!hasWatchSession) {
        // With no session there is nothing to schedule on, ever. The real
        // executor says so instead of resolving as though the rerun happened.
        events.push('browser:no-watch-session');
        return;
      }
      const seeded =
        testPaths && ownedPaths
          ? testPaths.filter((path) => ownedPaths.includes(path))
          : testPaths;
      // Seeding nothing means the request matched none of this host's files, so
      // there is no cycle to run: signalling anyway would print "no test files
      // need re-run" for a scope that was never the browser's to begin with.
      if (seeded && testPaths?.length && seeded.length === 0) {
        return;
      }
      await invalidateCallback!({
        isFirstBuild: false,
        fileFilters: seeded,
      });
    },
    /** Stand in for a browser rebuild / HMR trigger. */
    invalidate: async (fileFilters?: string[]) => {
      await invalidateCallback!({ isFirstBuild: false, fileFilters });
    },
  });
};

const createFakePlanner = (
  hasBrowserTestsToRun: boolean,
  browserProjects: ProjectContext[] = [],
): BrowserRunPlanner => ({
  runConfigHookDiscovery: async () => {},
  hasBrowserTestsToRun: () => hasBrowserTestsToRun,
  getBrowserProjectsToRun: () => browserProjects,
  getExecutorRunOptions: () => ({}),
});

const unreachable = (label: string) => () => {
  throw new Error(`${label} must not be reached in this run shape`);
};

const createDeps = (overrides: Partial<RunTestsDeps>): RunTestsDeps => ({
  createNodeExecutor: unreachable('createNodeExecutor'),
  loadBrowserExecutor: unreachable('loadBrowserExecutor'),
  createBrowserRunPlanner: unreachable('createBrowserRunPlanner'),
  runBrowserOnlyTests: unreachable('runBrowserOnlyTests'),
  runBrowserGlobalSetupStage: unreachable('runBrowserGlobalSetupStage'),
  isCliShortcutsEnabled: unreachable('isCliShortcutsEnabled'),
  setupCliShortcuts: unreachable('setupCliShortcuts'),
  createTraceController,
  ...overrides,
});

/**
 * A real `Rstest` (so the finalize reduces through the real reporter-result
 * state and config defaults) with its reporters swapped for one recorder, which
 * is how "exactly one finalize" is observed: `finalizeRunCycle` is the only
 * producer of `onTestRunEnd`.
 */
const createContext = ({
  command = 'run',
  nodeProjectNames = [],
  browserProjectNames = [],
}: {
  command?: 'run' | 'watch';
  nodeProjectNames?: string[];
  browserProjectNames?: string[];
}) => {
  const context = new Rstest(
    {
      cwd: rootPath,
      command,
      projects: [
        ...nodeProjectNames.map((name) => ({
          config: { root: join(rootPath, name), name },
        })),
        ...browserProjectNames.map((name) => ({
          config: {
            root: join(rootPath, name),
            name,
            browser: { enabled: true },
          },
        })),
      ],
    },
    {},
  );

  // An embedded host owns the process lifecycle, so `runTests` registers no
  // fatal-signal/exit handlers — watch never deregisters its own, and one that
  // survives the test would `process.exit` the worker on the next signal.
  context.embedded = true;

  const runEnds: RunEndPayload[] = [];
  let runStarts = 0;
  context.reporters = [
    {
      onTestRunStart: () => {
        runStarts += 1;
      },
      onTestRunEnd: (payload) => {
        runEnds.push(payload);
      },
    },
  ];

  return {
    context,
    runEnds,
    getRunStarts: () => runStarts,
  };
};

describe('runTests orchestration', () => {
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    // `finalizeRunCycle` writes `process.exitCode` and logs through rslog
    // (which fans out to the global console).
    originalExitCode = process.exitCode;
    rs.spyOn(console, 'log').mockImplementation(() => {});
    rs.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    rs.restoreAllMocks();
  });

  it('runs a non-watch mixed run through one cycle, one finalize, one close per executor', async () => {
    const events: string[] = [];
    const { context, runEnds, getRunStarts } = createContext({
      nodeProjectNames: ['node-a'],
      browserProjectNames: ['browser-a'],
    });
    const nodeExecutor = createFakeNodeExecutor({
      events,
      hasNodeTestsToRun: true,
      runCycle: async () => outcomeOf([passingFile('/node.test.ts', 'node-a')]),
    });
    const browserExecutor = createFakeBrowserExecutor(events, async () =>
      outcomeOf([passingFile('/browser.test.ts', 'browser-a')]),
    );

    await runTests(
      context,
      createDeps({
        createNodeExecutor: () => nodeExecutor,
        createBrowserRunPlanner: () => createFakePlanner(true),
        loadBrowserExecutor: async () => browserExecutor,
        runBrowserGlobalSetupStage: async () => ({ errors: [] }),
      }),
    );

    for (const executor of [nodeExecutor, browserExecutor]) {
      expect(executor.cycles).toHaveLength(1);
      expect(executor.cycles[0]).toMatchObject({ buildId: 1, mode: 'all' });
      expect(executor.closeCount).toBe(1);
    }
    expect(getRunStarts()).toBe(1);
    expect(runEnds).toHaveLength(1);
    expect(runEnds[0]!.results.map((result) => result.testPath)).toEqual([
      '/browser.test.ts',
      '/node.test.ts',
    ]);
    // Init barrier + node resources before the browser executor is loaded.
    expect(events.indexOf('node:init')).toBeLessThan(
      events.indexOf('node:ensure-run-resources'),
    );
    expect(events.indexOf('node:ensure-run-resources')).toBeLessThan(
      events.indexOf('browser:init'),
    );
  });

  it('replaces the browser cycle with the globalSetup failure outcome and still runs the node cycle', async () => {
    const events: string[] = [];
    const { context, runEnds } = createContext({
      nodeProjectNames: ['node-a'],
      browserProjectNames: ['browser-a'],
    });
    const setupError = new Error('browser globalSetup failed');
    const nodeExecutor = createFakeNodeExecutor({
      events,
      hasNodeTestsToRun: true,
      runCycle: async () => outcomeOf([passingFile('/node.test.ts', 'node-a')]),
    });
    const browserExecutor = createFakeBrowserExecutor(events, async () =>
      outcomeOf([passingFile('/browser.test.ts', 'browser-a')]),
    );

    await runTests(
      context,
      createDeps({
        createNodeExecutor: () => nodeExecutor,
        createBrowserRunPlanner: () => createFakePlanner(true),
        loadBrowserExecutor: async () => browserExecutor,
        runBrowserGlobalSetupStage: async () => ({ errors: [setupError] }),
      }),
    );

    expect(browserExecutor.cycles).toHaveLength(0);
    expect(nodeExecutor.cycles).toHaveLength(1);
    expect(runEnds).toHaveLength(1);
    expect(runEnds[0]!.unhandledErrors).toEqual([setupError]);
    expect(nodeExecutor.closeCount).toBe(1);
    expect(browserExecutor.closeCount).toBe(1);
  });

  it('settles every cycle before a rejecting one propagates, and still closes each executor once', async () => {
    const events: string[] = [];
    const { context, runEnds } = createContext({
      nodeProjectNames: ['node-a'],
      browserProjectNames: ['browser-a'],
    });
    const cycleError = new Error('browser cycle failed');
    const nodeExecutor = createFakeNodeExecutor({
      events,
      hasNodeTestsToRun: true,
      // Resolves on a later turn than the browser rejection: a fail-fast
      // `Promise.all` would reach teardown while this cycle is still running.
      runCycle: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return outcomeOf([passingFile('/node.test.ts', 'node-a')]);
      },
    });
    const browserExecutor = createFakeBrowserExecutor(events, async () => {
      throw cycleError;
    });

    await expect(
      runTests(
        context,
        createDeps({
          createNodeExecutor: () => nodeExecutor,
          createBrowserRunPlanner: () => createFakePlanner(true),
          loadBrowserExecutor: async () => browserExecutor,
          runBrowserGlobalSetupStage: async () => ({ errors: [] }),
        }),
      ),
    ).rejects.toBe(cycleError);

    expect(events.indexOf('node:cycle-end')).toBeGreaterThan(-1);
    expect(events.indexOf('node:cycle-end')).toBeLessThan(
      events.indexOf('node:close'),
    );
    expect(nodeExecutor.closeCount).toBe(1);
    expect(browserExecutor.closeCount).toBe(1);
    // The run never reached the finalize.
    expect(runEnds).toHaveLength(0);
  });

  it('finalizes an empty run and closes the node executor when nothing is runnable', async () => {
    const events: string[] = [];
    const { context, runEnds, getRunStarts } = createContext({
      nodeProjectNames: ['node-a'],
    });
    const nodeExecutor = createFakeNodeExecutor({
      events,
      hasNodeTestsToRun: false,
    });
    const loadBrowserExecutor = rs.fn<RunTestsDeps['loadBrowserExecutor']>(
      unreachable('loadBrowserExecutor'),
    );

    await runTests(
      context,
      createDeps({
        createNodeExecutor: () => nodeExecutor,
        createBrowserRunPlanner: () => createFakePlanner(false),
        loadBrowserExecutor,
      }),
    );

    expect(nodeExecutor.cycles).toHaveLength(0);
    expect(loadBrowserExecutor).not.toHaveBeenCalled();
    // The empty run still exits through the shared finalize, which reports the
    // no-test-files verdict.
    expect(getRunStarts()).toBe(0);
    expect(runEnds).toHaveLength(1);
    expect(runEnds[0]!.results).toEqual([]);
    expect(process.exitCode).toBe(1);
    expect(nodeExecutor.closeCount).toBe(1);
  });

  it('routes a browser-only run to the fast path without constructing a node executor', async () => {
    const { context } = createContext({ browserProjectNames: ['browser-a'] });
    const runBrowserOnlyTests = rs.fn<RunTestsDeps['runBrowserOnlyTests']>(
      async () => {},
    );

    await runTests(
      context,
      createDeps({
        // `createNodeExecutor` stays unreachable: booting a node Rsbuild
        // instance is exactly what the cold-start gate exists to avoid.
        runBrowserOnlyTests,
      }),
    );

    expect(runBrowserOnlyTests).toHaveBeenCalledTimes(1);
    expect(runBrowserOnlyTests.mock.calls[0]![1]).toEqual(context.projects);
  });
});

type CliShortcutHandlers = Parameters<RunTestsDeps['setupCliShortcuts']>[0];

/**
 * Boot a watch run and hand back the seams a real watch session is driven
 * through: each executor's invalidation trigger (a dev compile in production)
 * and the CLI shortcut handlers (a key press in production).
 */
const startWatchRun = async ({
  runCycle,
  testEntries,
  hasNodeTestsToRun = true,
  withBrowser = false,
  browserRunCycle = async () => outcomeOf([]),
  browserHasWatchSession = true,
  browserOwnedPaths,
}: {
  runCycle?: RunCycleImpl;
  testEntries?: string[];
  hasNodeTestsToRun?: boolean;
  withBrowser?: boolean;
  browserRunCycle?: RunCycleImpl;
  /** False stands in for a host launch that found no test files to watch. */
  browserHasWatchSession?: boolean;
  /** The paths the browser host would match a rerun request against. */
  browserOwnedPaths?: string[];
} = {}) => {
  const events: string[] = [];
  const parts = createContext({
    command: 'watch',
    nodeProjectNames: ['node-a'],
    browserProjectNames: withBrowser ? ['browser-a'] : [],
  });
  const nodeExecutor = createFakeNodeExecutor({
    events,
    hasNodeTestsToRun,
    runCycle,
    testEntries,
  });
  const browserExecutor = createFakeBrowserExecutor(
    events,
    browserRunCycle,
    browserHasWatchSession,
    browserOwnedPaths,
  );
  let shortcuts: CliShortcutHandlers | undefined;
  let setupCliShortcutsCalls = 0;

  await runTests(
    parts.context,
    createDeps({
      createNodeExecutor: () => nodeExecutor,
      createBrowserRunPlanner: () => createFakePlanner(withBrowser),
      loadBrowserExecutor: async () => browserExecutor,
      isCliShortcutsEnabled: () => true,
      setupCliShortcuts: async (options) => {
        setupCliShortcutsCalls += 1;
        shortcuts = options;
        return () => {};
      },
    }),
  );
  // The mixed watch path schedules the initial browser cycle without awaiting
  // it (the node side keeps the process alive).
  await flush();

  return {
    ...parts,
    events,
    nodeExecutor,
    browserExecutor,
    getShortcuts: () => shortcuts!,
    getSetupCliShortcutsCalls: () => setupCliShortcutsCalls,
  };
};

describe('runTests watch orchestration', () => {
  let originalExitCode: typeof process.exitCode;
  let logs: string[] = [];
  /** The ready banner is what tells the user the session is listening. */
  const readyBanners = () =>
    logs.filter((line) => line.includes('Waiting for file changes')).length;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    logs = [];
    rs.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '));
    });
    rs.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    rs.restoreAllMocks();
  });

  it('turns each invalidation into one cycle and one finalize, with the stdin owner installed once and before them', async () => {
    const {
      nodeExecutor,
      runEnds,
      getRunStarts,
      getShortcuts,
      getSetupCliShortcutsCalls,
    } = await startWatchRun();

    // Booting only subscribes; the first compile is what runs tests. The stdin
    // owner is already in place, so the ready banner is never printed before a
    // keystroke could be answered.
    expect(nodeExecutor.cycles).toHaveLength(0);
    expect(getSetupCliShortcutsCalls()).toBe(1);

    await nodeExecutor.invalidate(true);

    expect(nodeExecutor.cycles).toHaveLength(1);
    expect(nodeExecutor.cycles[0]).toMatchObject({ buildId: 1, mode: 'all' });
    expect(getRunStarts()).toBe(1);
    expect(runEnds).toHaveLength(1);

    await nodeExecutor.invalidate(false);

    // A rebuild reruns only what it affected, and never reinstalls the single
    // stdin owner.
    expect(nodeExecutor.cycles[1]).toMatchObject({
      buildId: 2,
      mode: 'on-demand',
    });
    expect(getRunStarts()).toBe(2);
    expect(runEnds).toHaveLength(2);
    expect(getSetupCliShortcutsCalls()).toBe(1);
    expect(getShortcuts()).toBeDefined();
  });

  it('resets the cycle-scoped state before the executor runs', async () => {
    const seen: Array<{ testFiles?: string[]; unmatched: number }> = [];
    const { context, nodeExecutor } = await startWatchRun({
      runCycle: async () => {
        seen.push({
          testFiles: context.stateManager.testFiles,
          unmatched: context.snapshotManager.summary.unmatched,
        });
        return outcomeOf([]);
      },
    });

    // The session's own first cycle, where only the snapshot half of the reset
    // is skipped — there is no previous cycle's summary to keep here anyway.
    await nodeExecutor.invalidate(true);

    context.stateManager.testFiles = ['/stale.test.ts'];
    context.snapshotManager.summary.unmatched = 3;

    await nodeExecutor.invalidate(false);

    expect(seen).toEqual([
      { testFiles: undefined, unmatched: 0 },
      { testFiles: undefined, unmatched: 0 },
    ]);
  });

  it('runs the browser initial cycle after node resources are up, and finalizes each executor separately', async () => {
    const { events, nodeExecutor, browserExecutor, runEnds } =
      await startWatchRun({
        withBrowser: true,
        browserRunCycle: async () =>
          outcomeOf([passingFile('/browser.test.ts', 'browser-a')]),
      });

    // Invariant #7: the browser host only launches once node resources exist.
    expect(events.indexOf('node:ensure-run-resources')).toBeLessThan(
      events.indexOf('browser:cycle-start'),
    );
    expect(browserExecutor.cycles).toHaveLength(1);
    expect(browserExecutor.cycles[0]).toMatchObject({ mode: 'all' });
    expect(runEnds).toHaveLength(1);

    await browserExecutor.invalidate(['/browser.test.ts']);

    expect(browserExecutor.cycles[1]).toMatchObject({
      mode: 'on-demand',
      fileFilters: ['/browser.test.ts'],
    });
    // One finalize per cycle, per executor — never a joint one.
    expect(runEnds).toHaveLength(2);
    expect(nodeExecutor.cycles).toHaveLength(0);
  });

  it('queues concurrent invalidations so two cycles never interleave', async () => {
    const { events, nodeExecutor, browserExecutor } = await startWatchRun({
      withBrowser: true,
      runCycle: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return outcomeOf([]);
      },
      browserRunCycle: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return outcomeOf([]);
      },
    });
    events.length = 0;

    await Promise.all([
      nodeExecutor.invalidate(false),
      browserExecutor.invalidate(),
    ]);

    expect(events.filter((event) => event.includes('cycle'))).toEqual([
      'node:cycle-start',
      'node:cycle-end',
      'browser:cycle-start',
      'browser:cycle-end',
    ]);
  });

  it('reruns everything on both sides for the a shortcut, node cycle first', async () => {
    const { context, nodeExecutor, getShortcuts, events } = await startWatchRun(
      { withBrowser: true },
    );
    await nodeExecutor.invalidate(true);
    events.length = 0;

    context.normalizedConfig.testNamePattern = 'only-this';
    context.fileFilters = ['/scoped.test.ts'];

    await getShortcuts().runAll!();

    expect(context.normalizedConfig.testNamePattern).toBeUndefined();
    expect(context.fileFilters).toBeUndefined();
    expect(nodeExecutor.cycles.at(-1)).toMatchObject({
      mode: 'all',
      fileFilters: undefined,
    });
    // One node cycle finalize, then the browser's own — the output shape a
    // mixed watch shortcut has to keep. That the browser's request precedes its
    // cycle is the fake's own doing, so it is not asserted here.
    expect(events.indexOf('node:cycle-end')).toBeLessThan(
      events.indexOf('browser:request-rerun:all'),
    );
  });

  it('scopes the f shortcut to the failed paths and fans the same set to the browser executor', async () => {
    const failing: TestFileResult = {
      ...passingFile('/fail.test.ts', 'node-a'),
      status: 'fail',
    };
    let cycleCount = 0;
    const { nodeExecutor, browserExecutor, getShortcuts, events } =
      await startWatchRun({
        withBrowser: true,
        runCycle: async () => {
          cycleCount += 1;
          return outcomeOf(cycleCount === 1 ? [failing] : []);
        },
      });
    await nodeExecutor.invalidate(true);

    await getShortcuts().runFailedTests!();

    expect(nodeExecutor.cycles.at(-1)).toMatchObject({
      mode: 'all',
      fileFilters: ['/fail.test.ts'],
    });
    expect(events).toContain('browser:request-rerun:/fail.test.ts');
    expect(browserExecutor.cycles.at(-1)).toMatchObject({
      mode: 'on-demand',
      fileFilters: ['/fail.test.ts'],
    });
  });

  it('runs the u shortcut with updateSnapshot forced to all on both sides and restores it afterwards', async () => {
    const unmatched: TestFileResult = {
      ...passingFile('/snap.test.ts', 'node-a'),
      snapshotResult: {
        filepath: '/snap.test.ts',
        added: 0,
        fileDeleted: false,
        matched: 0,
        unchecked: 0,
        uncheckedKeys: [],
        unmatched: 1,
        updated: 0,
      },
    };
    let cycleCount = 0;
    const { context, nodeExecutor, browserExecutor, getShortcuts, events } =
      await startWatchRun({
        withBrowser: true,
        runCycle: async () => {
          cycleCount += 1;
          return outcomeOf(cycleCount === 1 ? [unmatched] : []);
        },
      });
    await nodeExecutor.invalidate(true);
    const originalUpdateSnapshot =
      context.snapshotManager.options.updateSnapshot;
    context.snapshotManager.summary.unmatched = 1;

    await getShortcuts().updateSnapshot!();

    expect(nodeExecutor.cycles.at(-1)).toMatchObject({
      updateSnapshot: 'all',
      fileFilters: ['/snap.test.ts'],
    });
    // The single save/restore has to still be in force for the browser cycle,
    // which runs after the node one.
    expect(browserExecutor.cycles.at(-1)).toMatchObject({
      updateSnapshot: 'all',
    });
    expect(context.snapshotManager.options.updateSnapshot).toBe(
      originalUpdateSnapshot,
    );
    expect(events).toContain('browser:request-rerun:/snap.test.ts');
  });

  it('runs no browser cycle when the u shortcut scope is node-only', async () => {
    // The host seeds the request against its own file set; a scope that matches
    // none of its files seeds nothing, and a cycle that runs nothing would
    // report "no test files need re-run" for a scope that was never the
    // browser's. So the mixed `u` finalizes once, not twice.
    const unmatched: TestFileResult = {
      ...passingFile('/node-only.test.ts', 'node-a'),
      snapshotResult: {
        filepath: '/node-only.test.ts',
        added: 0,
        fileDeleted: false,
        matched: 0,
        unchecked: 0,
        uncheckedKeys: [],
        unmatched: 1,
        updated: 0,
      },
    };
    let cycleCount = 0;
    const { nodeExecutor, browserExecutor, getShortcuts, context, runEnds } =
      await startWatchRun({
        withBrowser: true,
        browserOwnedPaths: ['/browser-only.test.ts'],
        runCycle: async () => {
          cycleCount += 1;
          return outcomeOf(cycleCount === 1 ? [unmatched] : []);
        },
      });
    await nodeExecutor.invalidate(true);
    context.snapshotManager.summary.unmatched = 1;
    const browserCyclesBefore = browserExecutor.cycles.length;
    const finalizesBefore = runEnds.length;

    await getShortcuts().updateSnapshot!();

    expect(browserExecutor.cycles).toHaveLength(browserCyclesBefore);
    expect(runEnds.length - finalizesBefore).toBe(1);
  });

  it('restores updateSnapshot when the u shortcut rerun throws', async () => {
    const cycleError = new Error('rerun failed');
    let cycleCount = 0;
    const { context, nodeExecutor, getShortcuts } = await startWatchRun({
      runCycle: async () => {
        cycleCount += 1;
        if (cycleCount > 1) {
          throw cycleError;
        }
        return outcomeOf([]);
      },
    });
    await nodeExecutor.invalidate(true);
    const originalUpdateSnapshot =
      context.snapshotManager.options.updateSnapshot;
    context.snapshotManager.summary.unmatched = 1;

    await expect(getShortcuts().updateSnapshot!()).rejects.toBe(cycleError);

    expect(context.snapshotManager.options.updateSnapshot).toBe(
      originalUpdateSnapshot,
    );
  });

  it('keeps driving cycles after one has failed', async () => {
    const cycleError = new Error('cycle failed');
    let cycleCount = 0;
    const { nodeExecutor, runEnds } = await startWatchRun({
      runCycle: async () => {
        cycleCount += 1;
        if (cycleCount === 1) {
          throw cycleError;
        }
        return outcomeOf([]);
      },
    });

    await expect(nodeExecutor.invalidate(true)).rejects.toBe(cycleError);
    await nodeExecutor.invalidate(false);

    expect(runEnds).toHaveLength(1);
  });

  it('offers the t and p shortcuts only when a node side exists, and closes every executor once', async () => {
    const { getShortcuts, nodeExecutor, browserExecutor } = await startWatchRun(
      { withBrowser: true },
    );

    expect(getShortcuts().runWithTestNamePattern).toBeDefined();
    expect(getShortcuts().runWithFileFilters).toBeDefined();

    await getShortcuts().closeServer();
    await getShortcuts().closeServer();

    expect(nodeExecutor.closeCount).toBe(1);
    expect(browserExecutor.closeCount).toBe(1);
  });

  it('drops the t and p shortcuts when only browser tests run, and awaits the initial browser cycle', async () => {
    const { getShortcuts, browserExecutor, runEnds } = await startWatchRun({
      hasNodeTestsToRun: false,
      withBrowser: true,
    });

    expect(getShortcuts().runWithTestNamePattern).toBeUndefined();
    expect(getShortcuts().runWithFileFilters).toBeUndefined();
    expect(browserExecutor.cycles).toHaveLength(1);
    expect(runEnds).toHaveLength(1);

    await getShortcuts().runAll!();

    expect(browserExecutor.cycles).toHaveLength(2);
    expect(runEnds).toHaveLength(2);
  });

  it('offers no ready banner when the only launch opened no session', async () => {
    const { browserExecutor, runEnds } = await startWatchRun({
      hasNodeTestsToRun: false,
      withBrowser: true,
      browserHasWatchSession: false,
    });

    // The cycle still finalizes — that report is what tells the user there was
    // nothing to run — but no trigger can ever fire afterwards, so promising to
    // wait for file changes would be a promise nothing can keep.
    expect(browserExecutor.cycles).toHaveLength(1);
    expect(runEnds).toHaveLength(1);
    expect(readyBanners()).toBe(0);
  });

  it('offers the ready banner while the node side keeps the session live', async () => {
    const { nodeExecutor } = await startWatchRun({
      withBrowser: true,
      browserHasWatchSession: false,
    });

    await nodeExecutor.invalidate(true);

    expect(readyBanners()).toBe(2);
  });

  it('keeps every key answerable on the node side after the browser boot failed', async () => {
    // The mixed watch path swallows the browser initial cycle's rejection so the
    // node side keeps watching, and the banner it prints keeps offering
    // `a`/`f`/`u`. Gate those on a first cycle that *succeeded* and every one of
    // them answers "initial run in progress" for the rest of the session, and the
    // healthy node side can only be rerun by saving a file.
    const { nodeExecutor, getShortcuts, events } = await startWatchRun({
      withBrowser: true,
      browserRunCycle: async () => {
        throw new Error('browser launch failed');
      },
      browserHasWatchSession: false,
    });
    await nodeExecutor.invalidate(true);
    const nodeCycles = nodeExecutor.cycles.length;
    events.length = 0;

    await getShortcuts().runAll!();

    expect(getShortcuts().canRerun!()).toBe(true);
    expect(nodeExecutor.cycles).toHaveLength(nodeCycles + 1);
    // The dead side still has to answer for itself rather than look rerun.
    expect(events).toContain('browser:no-watch-session');
  });
});

describe('runTests trace buffer rotation', () => {
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    // `finalizeRunCycle` writes `process.exitCode` and logs through rslog
    // (which fans out to the global console).
    originalExitCode = process.exitCode;
    rs.spyOn(console, 'log').mockImplementation(() => {});
    rs.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    rs.restoreAllMocks();
  });

  /**
   * A trace controller that records every buffer it hands out, in allocation
   * order, together with the buffer itself and how many times that buffer was
   * finalized — so which cycle finalized which buffer is observable, and a dead
   * twin (allocated, never finalized) is too.
   */
  const createRecordingTraceController = () => {
    const runs: Array<{
      finalized: number;
      onEvents: () => void;
      finalize: () => Promise<void>;
    }> = [];
    return {
      runs,
      controller: (() => ({
        beginRun: () => {
          const run = {
            finalized: 0,
            onEvents: () => {},
            finalize: async () => {
              run.finalized += 1;
            },
          };
          runs.push(run);
          return run;
        },
        close: async () => {},
      })) as unknown as RunTestsDeps['createTraceController'],
    };
  };

  it('finalizes the buffer each watch cycle ran under and rotates the next one in', async () => {
    const { runs, controller } = createRecordingTraceController();
    const events: string[] = [];
    const { context } = createContext({
      command: 'watch',
      nodeProjectNames: ['node-a'],
    });
    const nodeExecutor = createFakeNodeExecutor({
      events,
      hasNodeTestsToRun: true,
    });

    await runTests(
      context,
      createDeps({
        createNodeExecutor: () => nodeExecutor,
        createBrowserRunPlanner: () => createFakePlanner(false),
        isCliShortcutsEnabled: () => false,
        createTraceController: controller,
      }),
    );

    // One pre-allocated buffer before any cycle runs, still open so browser
    // events arriving before the first cycle have somewhere to land.
    expect(runs.map((run) => run.finalized)).toEqual([0]);

    await nodeExecutor.invalidate(true);

    // The first cycle finalized the buffer it ran under — the pre-allocated
    // one — and rotated a fresh, still-open buffer in behind it.
    expect(runs.map((run) => run.finalized)).toEqual([1, 0]);

    await nodeExecutor.invalidate(false);

    // Same again for the rerun: each buffer is finalized exactly once, by the
    // cycle that ran under it, and never by a later one.
    expect(runs.map((run) => run.finalized)).toEqual([1, 1, 0]);
  });

  it('lets the browser-only fast path reuse the pre-allocated buffer', async () => {
    const { runs, controller } = createRecordingTraceController();
    const { context } = createContext({ browserProjectNames: ['browser-a'] });
    let handedOver: unknown;

    await runTests(
      context,
      createDeps({
        createTraceController: controller,
        runBrowserOnlyTests: async (_context, _projects, options) => {
          handedOver = options?.traceRun;
        },
      }),
    );

    // The fast path is handed the pre-allocated buffer itself, so its own
    // finalize lands on that buffer. A second `beginRun()` here would leave the
    // pre-allocated one as a dead, never-finalized twin instead.
    expect(runs).toHaveLength(1);
    expect(handedOver).toBe(runs[0]);
  });
});
