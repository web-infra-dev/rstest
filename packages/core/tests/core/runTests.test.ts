import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';
import { join } from 'pathe';
import type { BrowserRunPlanner } from '../../src/core/browser/runPlanner';
import { Rstest } from '../../src/core/rstest';
import { type RunTestsDeps, runTests } from '../../src/core/runTests';
import type {
  ExecutorCycleOutcome,
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
}: {
  events: string[];
  hasNodeTestsToRun: boolean;
  runCycle?: RunCycleImpl;
}) =>
  Object.assign(createFakeExecutor('node', events, runCycle), {
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
    globTestEntries: async () => [],
    getRsbuildInstance: () => {
      throw new Error('getRsbuildInstance is watch-only and unused here');
    },
  });

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
  ...overrides,
});

/**
 * A real `Rstest` (so the finalize reduces through the real reporter-result
 * state and config defaults) with its reporters swapped for one recorder, which
 * is how "exactly one finalize" is observed: `finalizeRunCycle` is the only
 * producer of `onTestRunEnd`.
 */
const createContext = ({
  nodeProjectNames = [],
  browserProjectNames = [],
}: {
  nodeProjectNames?: string[];
  browserProjectNames?: string[];
}) => {
  const context = new Rstest(
    {
      cwd: rootPath,
      command: 'run',
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
