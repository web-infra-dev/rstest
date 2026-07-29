import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';
import { join } from 'pathe';
import type { BrowserRunPlanner } from '../../src/core/browser/runPlanner';
import type { BrowserWatchOrchestrator } from '../../src/core/browser/watchControls';
import { Rstest } from '../../src/core/rstest';
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
 * teardown) can be asserted as a single sequence.
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
    validateRunDependencies: async () => {
      events.push('node:validate-run-dependencies');
    },
    globTestEntries: async () => testEntries,
    onInvalidate: (cb: ExecutorInvalidationCallback) => {
      invalidateCallback = cb;
    },
    /**
     * Stand in for a dev compile: the real executor awaits the callback inside
     * `onAfterDevCompile`, which is the back-pressure that serializes cycles.
     */
    invalidate: async (isFirstBuild: boolean) => {
      await invalidateCallback!({ isFirstBuild });
    },
  });
};

/** The browser side of the seam guarantees `collect` (`rstest list` uses it). */
const createFakeBrowserExecutor = (events: string[], runCycle: RunCycleImpl) =>
  Object.assign(createFakeExecutor('browser', events, runCycle), {
    collect: async () => ({ list: [] }),
  });

const createFakePlanner = (
  hasBrowserTestsToRun: boolean,
  browserProjects: ProjectContext[] = [],
): BrowserRunPlanner => ({
  runConfigHookDiscovery: async () => {},
  hasBrowserTestsToRun: () => hasBrowserTestsToRun,
  getBrowserProjectsToRun: () => browserProjects,
  getExecutorRunOptions: () => ({}),
  getWatchRunOptions: () => ({}),
});

/** Records the fanout a node-owned CLI shortcut makes to the browser session. */
const createFakeBrowserWatchOrchestrator = (
  events: string[],
): BrowserWatchOrchestrator => ({
  validate: async () => true,
  setup: async () => true,
  startBackground: () => {
    events.push('browser-watch:start-background');
  },
  runForeground: async () => {
    events.push('browser-watch:foreground');
  },
  rerun: async (testPaths) => {
    events.push(`browser-watch:rerun:${testPaths?.join(',') ?? 'all'}`);
  },
  close: async () => {
    events.push('browser-watch:close');
  },
});

const unreachable = (label: string) => () => {
  throw new Error(`${label} must not be reached in this run shape`);
};

const createDeps = (overrides: Partial<RunTestsDeps>): RunTestsDeps => ({
  createNodeExecutor: unreachable('createNodeExecutor'),
  loadBrowserExecutor: unreachable('loadBrowserExecutor'),
  createBrowserRunPlanner: unreachable('createBrowserRunPlanner'),
  createBrowserWatchOrchestrator: unreachable('createBrowserWatchOrchestrator'),
  runBrowserOnlyTests: unreachable('runBrowserOnlyTests'),
  runBrowserGlobalSetupStage: unreachable('runBrowserGlobalSetupStage'),
  isCliShortcutsEnabled: unreachable('isCliShortcutsEnabled'),
  setupCliShortcuts: unreachable('setupCliShortcuts'),
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
 * Boot a node watch run and hand back the seams a real watch session is driven
 * through: the executor's invalidation trigger (the dev compile in production)
 * and the CLI shortcut handlers (a key press in production).
 */
const startWatchRun = async ({
  runCycle,
  testEntries,
}: {
  runCycle?: RunCycleImpl;
  testEntries?: string[];
} = {}) => {
  const events: string[] = [];
  const parts = createContext({
    command: 'watch',
    nodeProjectNames: ['node-a'],
  });
  const nodeExecutor = createFakeNodeExecutor({
    events,
    hasNodeTestsToRun: true,
    runCycle,
    testEntries,
  });
  const browserWatch = createFakeBrowserWatchOrchestrator(events);
  let shortcuts: CliShortcutHandlers | undefined;
  let setupCliShortcutsCalls = 0;

  await runTests(
    parts.context,
    createDeps({
      createNodeExecutor: () => nodeExecutor,
      createBrowserRunPlanner: () => createFakePlanner(false),
      createBrowserWatchOrchestrator: () => browserWatch,
      isCliShortcutsEnabled: () => true,
      setupCliShortcuts: async (options) => {
        setupCliShortcutsCalls += 1;
        shortcuts = options;
        return () => {};
      },
    }),
  );

  return {
    ...parts,
    events,
    nodeExecutor,
    getShortcuts: () => shortcuts!,
    getSetupCliShortcutsCalls: () => setupCliShortcutsCalls,
  };
};

describe('runTests watch orchestration', () => {
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    rs.spyOn(console, 'log').mockImplementation(() => {});
    rs.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    rs.restoreAllMocks();
  });

  it('turns each invalidation into one cycle and one finalize, and installs the shortcuts once', async () => {
    const {
      nodeExecutor,
      runEnds,
      getRunStarts,
      getShortcuts,
      getSetupCliShortcutsCalls,
      events,
    } = await startWatchRun();

    // Booting only subscribes; the first compile is what runs tests.
    expect(nodeExecutor.cycles).toHaveLength(0);
    expect(events).toContain('browser-watch:start-background');
    expect(getSetupCliShortcutsCalls()).toBe(0);

    await nodeExecutor.invalidate(true);

    expect(nodeExecutor.cycles).toHaveLength(1);
    expect(nodeExecutor.cycles[0]).toMatchObject({ buildId: 1, mode: 'all' });
    expect(getRunStarts()).toBe(1);
    expect(runEnds).toHaveLength(1);
    expect(getSetupCliShortcutsCalls()).toBe(1);

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

    context.stateManager.testFiles = ['/stale.test.ts'];
    context.snapshotManager.summary.unmatched = 3;

    await nodeExecutor.invalidate(false);

    expect(seen).toEqual([{ testFiles: undefined, unmatched: 0 }]);
  });

  it('reruns everything on both sides for the a shortcut, node cycle first', async () => {
    const { context, nodeExecutor, getShortcuts, events } =
      await startWatchRun();
    await nodeExecutor.invalidate(true);

    context.normalizedConfig.testNamePattern = 'only-this';
    context.fileFilters = ['/scoped.test.ts'];

    await getShortcuts().runAll!();

    expect(context.normalizedConfig.testNamePattern).toBeUndefined();
    expect(context.fileFilters).toBeUndefined();
    expect(nodeExecutor.cycles[1]).toMatchObject({
      mode: 'all',
      fileFilters: undefined,
    });
    // One node cycle finalize, then the browser session's own rerun — the
    // output shape a mixed watch shortcut has to keep.
    expect(events.indexOf('node:cycle-end')).toBeLessThan(
      events.indexOf('browser-watch:rerun:all'),
    );
  });

  it('scopes the f shortcut to the failed paths and fans the same set to the browser session', async () => {
    const failing: TestFileResult = {
      ...passingFile('/fail.test.ts', 'node-a'),
      status: 'fail',
    };
    let cycleCount = 0;
    const { nodeExecutor, getShortcuts, events } = await startWatchRun({
      runCycle: async () => {
        cycleCount += 1;
        return outcomeOf(cycleCount === 1 ? [failing] : []);
      },
    });
    await nodeExecutor.invalidate(true);

    await getShortcuts().runFailedTests!();

    expect(nodeExecutor.cycles[1]).toMatchObject({
      mode: 'all',
      fileFilters: ['/fail.test.ts'],
    });
    expect(events).toContain('browser-watch:rerun:/fail.test.ts');
  });

  it('runs the u shortcut with updateSnapshot forced to all and restores it afterwards', async () => {
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
    const { context, nodeExecutor, getShortcuts, events } = await startWatchRun(
      {
        runCycle: async () => {
          cycleCount += 1;
          return outcomeOf(cycleCount === 1 ? [unmatched] : []);
        },
      },
    );
    await nodeExecutor.invalidate(true);
    const originalUpdateSnapshot =
      context.snapshotManager.options.updateSnapshot;
    context.snapshotManager.summary.unmatched = 1;

    await getShortcuts().updateSnapshot!();

    expect(nodeExecutor.cycles[1]).toMatchObject({
      updateSnapshot: 'all',
      fileFilters: ['/snap.test.ts'],
    });
    expect(context.snapshotManager.options.updateSnapshot).toBe(
      originalUpdateSnapshot,
    );
    expect(events).toContain('browser-watch:rerun:/snap.test.ts');
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
});
