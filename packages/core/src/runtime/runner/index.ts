import type {
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
import { collectErrorMessages } from '../util';
import type { TaskContext } from '../worker/taskContext';
import { TestRunner } from './runner';
import { RunnerRuntime, runtimeAPI } from './runtime';
import { traverseUpdateTest } from './task';

// The running file's execution-phase runner (see the live-binding contract in
// `../api`; `createRunner` publishes the context per file).
const currentRunner = (): TestRunner => fileContext().testRunner;

export type FileCleanupHooks = {
  onFileCleanupStart?: () => void;
  onFileCleanupEnd?: () => void;
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
}: {
  workerState: WorkerState;
  taskContext: TaskContext;
}): {
  runner: {
    runTests: (
      testFilePath: string,
      hooks: RunnerHooks & FileCleanupHooks,
      api: Rstest,
    ) => Promise<TestFileResult>;
    collectTests: () => Promise<TestInfo[]>;
    getCurrentTest: TestRunner['getCurrentTest'];
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

        const cleanupFileFixtures = async (result?: TestFileResult) => {
          hooks.onFileCleanupStart?.();
          try {
            return await testRunner.cleanupFileFixtures(result);
          } finally {
            hooks.onFileCleanupEnd?.();
          }
        };

        try {
          const results = await testRunner.runTests({
            tests,
            testPath,
            state: workerState,
            hooks,
            api,
            snapshotClient,
          });

          return (await cleanupFileFixtures(results))!;
        } catch (error) {
          try {
            await cleanupFileFixtures();
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              [
                'Test execution and file fixture cleanup both failed.',
                ...collectErrorMessages(error).map(
                  (message) => `Test execution failed: ${message}`,
                ),
                ...collectErrorMessages(cleanupError).map(
                  (message) => `File fixture cleanup failed: ${message}`,
                ),
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
