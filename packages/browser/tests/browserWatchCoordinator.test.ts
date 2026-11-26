import { describe, expect, it, rstest } from '@rstest/core';
import {
  reporterFileKey,
  type ExecutorCycleOutcome,
  type SelectedTestFile,
} from '@rstest/core/internal/browser';
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
  instanceName = `${name} (${browserName})`,
): BrowserProjectRuntime => ({
  name,
  browserName,
  instanceName,
  headless,
  environmentName: name,
  projectRoot: `/root/${name}`,
  hasSetupFiles: false,
  screenshotFailures: false,
  providerOptions: {},
  launchKey: `[playwright,${browserName},${headless}]`,
  runtimeConfig: {} as BrowserProjectRuntime['runtimeConfig'],
});

const makeHeadedLane = (row: BrowserProjectRuntime) => {
  let uiRerunHandler:
    | ((file: TestFileInfo, testNamePattern?: string) => Promise<void>)
    | undefined;
  const runScope = rstest.fn(async () => [`cov:${row.instanceName}`]);
  const syncFileSet = rstest.fn(async () => {});
  const setPendingTestNamePattern = rstest.fn();
  const lane: HeadedLaneResult = {
    containerId: row.instanceName,
    row,
    testTime: 0,
    runScope,
    syncFileSet,
    setPendingTestNamePattern,
    setUiRerunHandler: (handler) => {
      uiRerunHandler = handler;
    },
  };
  return {
    lane,
    runScope,
    syncFileSet,
    setPendingTestNamePattern,
    triggerUiRerun: (file: TestFileInfo, testNamePattern?: string) =>
      uiRerunHandler!(file, testNamePattern),
  };
};

describe('createBrowserWatchCoordinator', () => {
  it('runs mixed headless and multiple headed lanes in parallel on file change and scopes UI reruns to the clicked window', async () => {
    const chromiumHeaded = makeRow('web', 'chromium', false);
    const webkitHeaded = makeRow('web', 'webkit', false);
    const firefoxHeadless = makeRow('web', 'firefox', true);

    const fileA: TestFileInfo = {
      testPath: '/root/web/a.test.ts',
      projectName: 'web',
    };
    const fileB: TestFileInfo = {
      testPath: '/root/web/b.test.ts',
      projectName: 'web',
    };

    const watchState = {
      lastTestFiles: [fileA, fileB],
      hooksEnabled: true,
      headedContainers: new Map(),
      invalidation: new Map(),
      pendingAffectedTestFiles: new Map([['web', new Set([fileA.testPath])]]),
      pendingDeletedTestFiles: [],
      compileStartTimes: new Map(),
      pendingBuildTimeMs: 0,
    } as unknown as BrowserRuntime['watchState'];

    const headlessRunScope = rstest.fn(async () => ['cov:web (firefox)']);
    const headlessLane: HeadlessLaneResult = {
      testTime: 0,
      runScope: headlessRunScope,
    };
    const headedChromium = makeHeadedLane(chromiumHeaded);
    const headedWebkit = makeHeadedLane(webkitHeaded);

    let session!: ReturnType<typeof createBrowserWatchCoordinator>;
    const selectedHistory: SelectedTestFile[][] = [];
    const outcomeKeysHistory: string[][] = [];
    const coverageHistory: unknown[][] = [];

    const watchSignals = createWatchSignals(
      async ({ fileFilters, updateSnapshot }) => {
        const outcome = await session.runCycle(
          fileFilters ?? [],
          updateSnapshot ?? 'none',
          async (selected) => {
            selectedHistory.push(selected);
            return undefined;
          },
        );
        coverageHistory.push(outcome.coverage?.raw ?? []);
      },
    );

    session = createBrowserWatchCoordinator({
      watchState,
      watchSignals,
      headlessLane,
      headlessRows: [firefoxHeadless],
      headedLanes: [headedChromium.lane, headedWebkit.lane],
      collectProjectEntries: async () => [
        {
          project: { name: 'web' } as any,
          testFiles: [fileA.testPath, fileB.testPath],
        },
      ],
      logWatchReady: () => {},
      hasMatchingTestPath: () => true,
      getFatalCompileError: () => undefined,
      fatalErrorRef: { current: null },
      buildRerunOutcome: ({
        rerunTestPaths,
        executedFileKeys,
        testTime,
        rawCoverage,
      }): ExecutorCycleOutcome => {
        outcomeKeysHistory.push([...(executedFileKeys ?? [])]);
        return {
          results: [],
          testResults: [],
          errors: [],
          testPaths: rerunTestPaths,
          duration: { buildTime: 0, testTime },
          coverage: rawCoverage.length ? { raw: rawCoverage } : undefined,
        };
      },
    });

    // 1. File change rerun: all three lanes (1 headless + 2 headed) run fileA.
    await watchSignals.runDispatchRerun();
    await watchSignals.awaitSignalledCycle();

    expect(headlessRunScope).toHaveBeenCalledTimes(1);
    expect(headlessRunScope).toHaveBeenCalledWith([fileA.testPath], 'none');
    expect(headedChromium.runScope).toHaveBeenCalledTimes(1);
    expect(headedChromium.runScope).toHaveBeenCalledWith(
      [fileA.testPath],
      'none',
    );
    expect(headedWebkit.runScope).toHaveBeenCalledTimes(1);
    expect(headedWebkit.runScope).toHaveBeenCalledWith(
      [fileA.testPath],
      'none',
    );
    expect(selectedHistory[0]!.map((f) => f.project)).toEqual([
      'web (firefox)',
      'web (chromium)',
      'web (webkit)',
    ]);
    expect(coverageHistory[0]).toEqual([
      'cov:web (firefox)',
      'cov:web (chromium)',
      'cov:web (webkit)',
    ]);

    // 2. UI rerun clicked in chromium window: ONLY chromium runs, with its pattern.
    await headedChromium.triggerUiRerun(fileB, 'only this case');

    expect(headlessRunScope).toHaveBeenCalledTimes(1);
    expect(headedWebkit.runScope).toHaveBeenCalledTimes(1);
    expect(headedChromium.runScope).toHaveBeenCalledTimes(2);
    expect(headedChromium.runScope).toHaveBeenLastCalledWith(
      [fileB.testPath],
      'none',
    );
    expect(headedChromium.setPendingTestNamePattern).toHaveBeenCalledWith(
      fileB.testPath,
      'only this case',
    );
    expect(selectedHistory[1]).toEqual([
      { testPath: fileB.testPath, project: 'web (chromium)' },
    ]);
    expect(outcomeKeysHistory[1]).toEqual([
      reporterFileKey('web (chromium)', fileB.testPath),
    ]);
    expect(coverageHistory[1]).toEqual(['cov:web (chromium)']);
  });

  it('syncs file-set updates to all headed lanes before signalling invalidation', async () => {
    const chromiumHeaded = makeRow('web', 'chromium', false);
    const firefoxHeaded = makeRow('web', 'firefox', false);
    const fileA: TestFileInfo = {
      testPath: '/root/web/a.test.ts',
      projectName: 'web',
    };
    const fileAdded: TestFileInfo = {
      testPath: '/root/web/added.test.ts',
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

    const headedChromium = makeHeadedLane(chromiumHeaded);
    const headedFirefox = makeHeadedLane(firefoxHeaded);
    const callOrder: string[] = [];
    headedChromium.syncFileSet.mockImplementation(async () => {
      callOrder.push('sync:chromium');
    });
    headedFirefox.syncFileSet.mockImplementation(async () => {
      callOrder.push('sync:firefox');
    });

    let session!: ReturnType<typeof createBrowserWatchCoordinator>;
    const watchSignals = createWatchSignals(async ({ fileFilters }) => {
      callOrder.push('signal');
      await session.runCycle(fileFilters ?? [], 'none');
    });

    session = createBrowserWatchCoordinator({
      watchState,
      watchSignals,
      headlessRows: [],
      headedLanes: [headedChromium.lane, headedFirefox.lane],
      collectProjectEntries: async () => [
        {
          project: { name: 'web' } as any,
          testFiles: [fileA.testPath, fileAdded.testPath],
        },
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

    await watchSignals.runDispatchRerun();
    await watchSignals.awaitSignalledCycle();

    expect(callOrder.slice(0, 2).sort()).toEqual([
      'sync:chromium',
      'sync:firefox',
    ]);
    expect(callOrder[2]).toBe('signal');
    expect(headedChromium.runScope).toHaveBeenCalledWith(
      [fileA.testPath, fileAdded.testPath],
      'none',
    );
    expect(headedFirefox.runScope).toHaveBeenCalledWith(
      [fileA.testPath, fileAdded.testPath],
      'none',
    );
  });
});
