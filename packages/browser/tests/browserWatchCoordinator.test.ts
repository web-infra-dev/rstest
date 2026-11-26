import { describe, expect, it, rstest } from '@rstest/core';
import type { ExecutorCycleOutcome } from '@rstest/core/internal/browser';
import type { SnapshotUpdateState } from '@vitest/snapshot';
import type { BrowserRuntime } from '../src/browserRsbuild';
import { createBrowserWatchCoordinator } from '../src/browserWatchCoordinator';
import type { BrowserProjectRuntime, TestFileInfo } from '../src/protocol';
import type {
  HeadedLaneResult,
  HeadlessLaneResult,
} from '../src/schedulerSeam';
import { createWatchSignals } from '../src/watchSignals';

const makeRow = (
  name: string,
  browserName: BrowserProjectRuntime['browserName'],
  headless: boolean,
): BrowserProjectRuntime => ({
  name,
  browserName,
  instanceName: `${name} (${browserName})`,
  headless,
  environmentName: name,
  projectRoot: `/root/${name}`,
  hasSetupFiles: false,
  screenshotFailures: false,
  providerOptions: {},
  launchKey: `[playwright,${browserName},${headless}]`,
  runtimeConfig: {} as BrowserProjectRuntime['runtimeConfig'],
});

/**
 * Minimal replica of core's `createWatchCycleDriver` folding/queueing seam:
 * serializes cycles on `tail`, folds open queued cycles iff `updateSnapshot`
 * matches (returning the same cycle promise), and keeps differing snapshot
 * policies as distinct FIFO cycles.
 */
const createQueuedWatchDriver = (
  runCycle: (
    fileFilters: string[],
    updateSnapshot: SnapshotUpdateState,
  ) => Promise<void>,
  sessionUpdateSnapshot: SnapshotUpdateState = 'none',
) => {
  type Pending = {
    updateSnapshot: SnapshotUpdateState;
    fileFilters: string[];
    isOpen: boolean;
    cycle: Promise<void>;
  };
  let tail: Promise<void> = Promise.resolve();
  let queued: Pending | undefined;

  return ({
    fileFilters = [],
    updateSnapshot,
  }: {
    fileFilters?: string[];
    updateSnapshot?: SnapshotUpdateState;
  }) => {
    const resolvedPolicy = updateSnapshot ?? sessionUpdateSnapshot;
    if (queued?.isOpen && queued.updateSnapshot === resolvedPolicy) {
      queued.fileFilters = [
        ...new Set([...queued.fileFilters, ...fileFilters]),
      ];
      return queued.cycle;
    }
    const entry: Pending = {
      updateSnapshot: resolvedPolicy,
      fileFilters: [...fileFilters],
      isOpen: true,
      cycle: Promise.resolve(),
    };
    entry.cycle = tail.then(() => {
      entry.isOpen = false;
      return runCycle(entry.fileFilters, entry.updateSnapshot);
    });
    queued = entry;
    tail = entry.cycle.catch(() => {});
    return entry.cycle;
  };
};

const flushTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const createCoordinatorHarness = () => {
  const chromiumRow = makeRow('web', 'chromium', false);
  const webkitRow = makeRow('web', 'webkit', false);
  const firefoxRow = makeRow('web', 'firefox', true);
  const fileA: TestFileInfo = {
    testPath: '/root/web/a.test.ts',
    projectName: 'web',
  };

  const watchState = {
    lastTestFiles: [fileA],
    hooksEnabled: true,
    headedContainers: new Map(),
    invalidation: new Map(),
    pendingAffectedTestFiles: new Map(),
    pendingDeletedTestFiles: [],
    compileStartTimes: new Map(),
    pendingBuildTimeMs: 0,
  } as unknown as BrowserRuntime['watchState'];

  const executedCycles: Array<{
    updateSnapshot: SnapshotUpdateState;
    lanes: string[];
    patterns: Record<string, string | undefined>;
  }> = [];
  let currentCycleRecord: (typeof executedCycles)[number] | undefined;

  const releaseInitialCycle = Promise.withResolvers<void>();
  const initialCycleStarted = Promise.withResolvers<void>();
  let isFirstCycle = true;

  const headlessLane: HeadlessLaneResult = {
    testTime: 0,
    runScope: rstest.fn(async () => {
      currentCycleRecord?.lanes.push('web (firefox)');
      if (isFirstCycle) {
        initialCycleStarted.resolve();
        await releaseInitialCycle.promise;
      }
      return [];
    }),
  };

  const makeHeadedLane = (row: BrowserProjectRuntime) => {
    let uiRerun:
      ((file: TestFileInfo, pattern?: string) => Promise<void>) | undefined;
    const lane: HeadedLaneResult = {
      containerId: row.instanceName,
      row,
      testTime: 0,
      runScope: rstest.fn(
        async (
          paths: string[],
          _updateSnapshot: SnapshotUpdateState,
          patterns?: Map<string, string>,
        ) => {
          currentCycleRecord?.lanes.push(row.instanceName);
          currentCycleRecord!.patterns[row.instanceName] = patterns?.get(
            paths[0]!,
          );
          return [];
        },
      ),
      syncFileSet: async () => {},
      setUiRerunHandler: (handler) => {
        uiRerun = handler;
      },
    };
    return {
      lane,
      triggerUiRerun: (file: TestFileInfo, pattern?: string) =>
        uiRerun!(file, pattern),
    };
  };

  const headedChromium = makeHeadedLane(chromiumRow);
  const headedWebkit = makeHeadedLane(webkitRow);

  let session!: ReturnType<typeof createBrowserWatchCoordinator>;
  const watchSignals = createWatchSignals(
    createQueuedWatchDriver(async (fileFilters, updateSnapshot) => {
      currentCycleRecord = { updateSnapshot, lanes: [], patterns: {} };
      executedCycles.push(currentCycleRecord);
      await session.runCycle(fileFilters, updateSnapshot);
      isFirstCycle = false;
    }),
  );

  const interrupts: string[] = [];
  watchSignals.addInterrupt(() => {
    interrupts.push('headless');
  }, 'headless');
  watchSignals.addInterrupt(() => {
    interrupts.push(chromiumRow.instanceName);
  }, chromiumRow.instanceName);
  watchSignals.addInterrupt(() => {
    interrupts.push(webkitRow.instanceName);
  }, webkitRow.instanceName);

  session = createBrowserWatchCoordinator({
    watchState,
    watchSignals,
    headlessLane,
    headlessRows: [firefoxRow],
    headedLanes: [headedChromium.lane, headedWebkit.lane],
    collectProjectEntries: async () => [
      { project: { name: 'web' } as any, testFiles: [fileA.testPath] },
    ],
    logWatchReady: () => {},
    hasMatchingTestPath: () => true,
    getFatalCompileError: () => undefined,
    fatalErrorRef: { current: null },
    buildRerunOutcome: ({
      rerunTestPaths,
      testTime,
    }): ExecutorCycleOutcome => ({
      results: [],
      testResults: [],
      errors: [],
      testPaths: rerunTestPaths,
      duration: { buildTime: 0, testTime },
    }),
  });

  return {
    fileA,
    session,
    headedChromium,
    interrupts,
    executedCycles,
    initialCycleStarted: initialCycleStarted.promise,
    releaseInitialCycle: () => releaseInitialCycle.resolve(),
  };
};

describe('browser watch coordinator concurrency invariants', () => {
  it('interrupts only the clicked container on UI rerun and binds targets per queued cycle across snapshot policies', async () => {
    const harness = createCoordinatorHarness();

    // Cycle 0: start a full rerun and pause while it is in flight.
    const cycle0 = harness.session.requestRerun(
      [harness.fileA.testPath],
      'none',
    );
    await harness.initialCycleStarted;
    harness.interrupts.length = 0;

    // Queue Cycle 1: snapshot-update rerun (`updateSnapshot: 'all'`) for fileA.
    const cycle1 = harness.session.requestRerun(
      [harness.fileA.testPath],
      'all',
    );
    await flushTurn();
    // Full-scope rerun interrupts every lane.
    expect(harness.interrupts).toEqual([
      'headless',
      'web (chromium)',
      'web (webkit)',
    ]);
    harness.interrupts.length = 0;

    // Queue Cycle 2: UI rerun in chromium (`updateSnapshot: 'none'`, cannot
    // fold into Cycle 1's `'all'`) while Cycle 0 is still active.
    const cycle2 = harness.headedChromium.triggerUiRerun(
      harness.fileA,
      'only chromium case',
    );
    await flushTurn();
    // UI rerun must interrupt ONLY the clicked container, leaving sibling
    // headed and headless lanes undisturbed.
    expect(harness.interrupts).toEqual(['web (chromium)']);

    harness.releaseInitialCycle();
    await Promise.all([cycle0, cycle1, cycle2]);

    // Cycle 1 ran every lane with updateSnapshot: 'all' and no pattern.
    expect(harness.executedCycles[1]).toEqual({
      updateSnapshot: 'all',
      lanes: ['web (firefox)', 'web (chromium)', 'web (webkit)'],
      patterns: { 'web (chromium)': undefined, 'web (webkit)': undefined },
    });
    // Cycle 2 kept its own target and pattern instead of being consumed by
    // Cycle 1 or falling back to `'all'`.
    expect(harness.executedCycles[2]).toEqual({
      updateSnapshot: 'none',
      lanes: ['web (chromium)'],
      patterns: { 'web (chromium)': 'only chromium case' },
    });
  });

  it('merges same-policy triggers folded into one cycle and clears stale testNamePattern on full rerun', async () => {
    const harness = createCoordinatorHarness();

    const cycle0 = harness.session.requestRerun(
      [harness.fileA.testPath],
      'none',
    );
    await harness.initialCycleStarted;

    // Queue a UI single-test rerun (`updateSnapshot: 'none'`), then fold a
    // full-scope rerun with the same policy into the open queued cycle.
    const uiTrigger = harness.headedChromium.triggerUiRerun(
      harness.fileA,
      'only one test',
    );
    await flushTurn();
    const fullTrigger = harness.session.requestRerun(
      [harness.fileA.testPath],
      'none',
    );
    await flushTurn();

    harness.releaseInitialCycle();
    await Promise.all([cycle0, uiTrigger, fullTrigger]);

    // Folded into a single follow-up cycle covering all lanes with the stale
    // single-test pattern cleared.
    expect(harness.executedCycles).toHaveLength(2);
    expect(harness.executedCycles[1]).toEqual({
      updateSnapshot: 'none',
      lanes: ['web (firefox)', 'web (chromium)', 'web (webkit)'],
      patterns: { 'web (chromium)': undefined, 'web (webkit)': undefined },
    });
  });
});
