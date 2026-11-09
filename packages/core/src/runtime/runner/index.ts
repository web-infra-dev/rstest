import type {
  MaybePromise,
  Rstest,
  RunnerAPI,
  RunnerHooks,
  RawTestFileResult,
  RawTestInfo,
  Test,
  WorkerState,
} from '../../types';
import { getFileTaskId } from '../../utils/helper';
import { fileContext, setFileContext } from '../fileContext';
import type { TaskContext } from '../worker/taskContext';
import { TestRunner } from './runner';
import { RunnerRuntime, runtimeAPI, type RootSuiteListeners } from './runtime';
import { traverseUpdateTest } from './task';
import { isError } from '../../utils/isError';

// The running file's execution-phase runner (see the live-binding contract in
// `../api`; `createRunner` publishes the context per file).
const currentRunner = (): TestRunner => fileContext().testRunner;

export type FileCleanupHooks = {
  onFileCleanupStart?: (result?: RawTestFileResult) => MaybePromise<void>;
  onFileCleanupEnd?: () => MaybePromise<void>;
};

const onTestFinished: RunnerAPI['onTestFinished'] = (...args) => {
  const runner = currentRunner();
  runner.onTestFinished(runner.getCurrentTest(), ...args);
};

const onTestFailed: RunnerAPI['onTestFailed'] = (...args) => {
  const runner = currentRunner();
  runner.onTestFailed(runner.getCurrentTest(), ...args);
};

/**
 * The full stable `@rstest/core` runner surface, built once: the collection-phase
 * `runtimeAPI` plus the execution-phase `onTestFinished`/`onTestFailed`
 * forwarders. Spread into the injected api by `createRstestRuntime` (`../api`).
 */
export const runnerAPI: RunnerAPI = {
  ...runtimeAPI,
  onTestFinished,
  onTestFailed,
};

export function createRunner({
  workerState,
  taskContext,
  runtimeGlobal,
}: {
  workerState: WorkerState;
  taskContext: TaskContext;
  runtimeGlobal?: Record<string, unknown>;
}): {
  runner: {
    runTests: (
      testFilePath: string,
      hooks: RunnerHooks & FileCleanupHooks,
      api: Rstest,
    ) => Promise<RawTestFileResult>;
    prepareTests: (testFilePath: string, hooks?: RunnerHooks) => Promise<void>;
    collectTests: () => Promise<RawTestInfo[]>;
    getCurrentTest: TestRunner['getCurrentTest'];
    getRootSuiteListeners: () => RootSuiteListeners;
    setRootSuiteListeners: (listeners: RootSuiteListeners) => void;
  };
} {
  const {
    testPath,
    project,
    runtimeConfig: { testNamePattern },
  } = workerState;
  const runtimeInstance = new RunnerRuntime({
    project,
    testPath,
    runtimeConfig: workerState.runtimeConfig,
    browserName: workerState.browserName,
  });
  const testRunner: TestRunner = new TestRunner(taskContext);
  // Publish this file's context as one unit; every stable forwarder (runner
  // surface, `expect`, `rstest` config methods) resolves it at call time.
  setFileContext({
    workerState,
    runtimeGlobal,
    runnerRuntime: runtimeInstance,
    testRunner,
  });

  // Node workers collect before closing their loading interval. Reuse the
  // prepared tree when execution starts, including its resolved run modes.
  let collectedTests: Test[] | undefined;
  let isPrepared = false;
  const ensureCollected = async (): Promise<Test[]> => {
    if (!collectedTests) {
      const tests = await runtimeInstance.getTests();
      traverseUpdateTest(tests, testNamePattern);
      collectedTests = tests;
    }
    return collectedTests;
  };

  return {
    runner: {
      runTests: async (
        testPath: string,
        hooks: RunnerHooks & FileCleanupHooks,
        api: Rstest,
      ) => {
        if (!isPrepared) {
          throw new Error('prepareTests() must complete before runTests().');
        }
        const snapshotClient = workerState.snapshotClient!;
        const tests = collectedTests!;
        hooks.onTestFileReady?.({
          testId: getFileTaskId({
            project: workerState.project,
            testPath,
            browserName: workerState.browserName,
          }),
          testPath,
          project: workerState.project,
          browserName: workerState.browserName,
          tests: tests.map(toTestInfo),
        });
        runtimeInstance.updateStatus('running');

        try {
          const results = await testRunner.runTests({
            tests,
            testPath,
            state: workerState,
            hooks,
            api,
            snapshotClient,
          });

          await hooks.onFileCleanupStart?.(results);
          try {
            return (await testRunner.cleanupFileFixtures(results))!;
          } finally {
            await hooks.onFileCleanupEnd?.();
          }
        } catch (error) {
          try {
            await hooks.onFileCleanupStart?.();
            try {
              await testRunner.cleanupFileFixtures();
            } finally {
              await hooks.onFileCleanupEnd?.();
            }
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              [
                'Test execution and file fixture cleanup both failed.',
                `Test execution failed: ${isError(error) ? error.message : String(error)}`,
                `File fixture cleanup failed: ${isError(cleanupError) ? cleanupError.message : String(cleanupError)}`,
              ].join('\n'),
            );
          }
          throw error;
        }
      },
      prepareTests: async (testPath, hooks) => {
        if (isPrepared) return;
        await hooks?.onSnapshotSetupStart?.();
        try {
          await workerState.snapshotClient!.setup(
            testPath,
            workerState.snapshotOptions,
          );
        } finally {
          await hooks?.onSnapshotSetupEnd?.();
        }
        await ensureCollected();
        isPrepared = true;
      },
      collectTests: async () => {
        const tests = await ensureCollected();

        return tests.map(toTestInfo);
      },
      getCurrentTest: () => testRunner.getCurrentTest(),
      getRootSuiteListeners: () => runtimeInstance.getRootSuiteListeners(),
      setRootSuiteListeners: (listeners) =>
        runtimeInstance.setRootSuiteListeners(listeners),
    },
  };
}

function toTestInfo(test: Test): RawTestInfo {
  return {
    testId: test.testId,
    name: test.name,
    parentNames: test.parentNames,
    testPath: test.testPath,
    project: test.project,
    type: test.type,
    location: test.location,
    meta: test.meta,
    tests: test.type === 'suite' ? test.tests.map(toTestInfo) : [],
    runMode: test.runMode,
  };
}
