import type {
  MaybePromise,
  Rstest,
  RunnerAPI,
  RunnerHooks,
  Test,
  TestFileResult,
  TestInfo,
  WorkerState,
} from '../../types';
import { getFileTaskId } from '../../utils/helper';
import { fileContext, setFileContext } from '../fileContext';
import type { TaskContext } from '../worker/taskContext';
import { TestRunner } from './runner';
import {
  RunnerRuntime,
  runtimeAPI,
  type TestSuiteListenersSnapshot,
} from './runtime';
import { traverseUpdateTest } from './task';

// The running file's execution-phase runner (see the live-binding contract in
// `../api`; `createRunner` publishes the context per file).
const currentRunner = (): TestRunner => fileContext().testRunner;

export type FileCleanupHooks = {
  onFileCleanupStart?: (result?: TestFileResult) => MaybePromise<void>;
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
  setupListeners,
}: {
  workerState: WorkerState;
  taskContext: TaskContext;
  setupListeners?: TestSuiteListenersSnapshot;
}): {
  runner: {
    runTests: (
      testFilePath: string,
      hooks: RunnerHooks & FileCleanupHooks,
      api: Rstest,
    ) => Promise<TestFileResult>;
    collectTests: () => Promise<TestInfo[]>;
    getCurrentTest: TestRunner['getCurrentTest'];
    getRootSuiteListeners: () => TestSuiteListenersSnapshot;
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
  });
  if (setupListeners) {
    runtimeInstance.setRootSuiteListeners(setupListeners);
  }
  const testRunner: TestRunner = new TestRunner(taskContext);
  // Publish this file's context as one unit; every stable forwarder (runner
  // surface, `expect`, `rstest` config methods) resolves it at call time.
  setFileContext({ workerState, runnerRuntime: runtimeInstance, testRunner });

  return {
    runner: {
      runTests: async (
        testPath: string,
        hooks: RunnerHooks & FileCleanupHooks,
        api: Rstest,
      ) => {
        const snapshotClient = workerState.snapshotClient!;

        await snapshotClient.setup(testPath, workerState.snapshotOptions);

        const tests = await runtimeInstance.getTests();
        traverseUpdateTest(tests, testNamePattern);
        hooks.onTestFileReady?.({
          testId: getFileTaskId(testPath),
          testPath,
          project: workerState.project,
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
                `Test execution failed: ${error instanceof Error ? error.message : String(error)}`,
                `File fixture cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
              ].join('\n'),
            );
          }
          throw error;
        }
      },
      collectTests: async () => {
        const tests = await runtimeInstance.getTests();
        traverseUpdateTest(tests, testNamePattern);

        return tests.map(toTestInfo);
      },
      getCurrentTest: () => testRunner.getCurrentTest(),
      getRootSuiteListeners: () => runtimeInstance.getRootSuiteListeners(),
    },
  };
}

function toTestInfo(test: Test): TestInfo {
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
