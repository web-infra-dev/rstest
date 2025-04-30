import { GLOBAL_EXPECT, getState, setState } from '@vitest/expect';
import type { SnapshotState } from '@vitest/snapshot';
import type {
  AfterEachListener,
  BeforeEachListener,
  Rstest,
  RunnerHooks,
  SuiteContext,
  Test,
  TestCase,
  TestError,
  TestFileResult,
  TestResult,
  TestResultStatus,
  WorkerState,
} from '../../types';
import { getTaskNameWithPrefix } from '../../utils';
import { getSnapshotClient } from '../api/snapshot';
import { formatTestError } from '../util';
import {
  getTestStatus,
  markAllTestAsSkipped,
  traverseUpdateTest,
} from './task';

export class TestRunner {
  /** current test case */
  private _test: TestCase | undefined;

  async runTests({
    tests,
    testPath,
    state,
    hooks,
    api,
  }: {
    tests: Test[];
    testPath: string;
    state: WorkerState;
    hooks: RunnerHooks;
    api: Rstest;
  }): Promise<TestFileResult> {
    const {
      runtimeConfig: { passWithNoTests, testNamePattern, retry },
      snapshotOptions,
    } = state;
    const results: TestResult[] = [];
    const errors: TestError[] = [];
    let defaultStatus: TestResultStatus = 'pass';

    hooks.onTestFileStart?.({ filePath: testPath });
    const snapshotClient = getSnapshotClient();

    await snapshotClient.setup(testPath, snapshotOptions);

    const runTestsCase = async (
      test: TestCase,
      parentHooks: {
        beforeEachListeners: BeforeEachListener[];
        afterEachListeners: AfterEachListener[];
      },
    ): Promise<TestResult> => {
      if (test.runMode === 'skip') {
        const result = {
          status: 'skip' as const,
          parentNames: test.parentNames,
          name: test.name,
          testPath,
        };
        return result;
      }
      if (test.runMode === 'todo') {
        const result = {
          status: 'todo' as const,
          parentNames: test.parentNames,
          name: test.name,
          testPath,
        };
        return result;
      }

      let result: TestResult | undefined = undefined;

      this.beforeEach(test, state, api);

      const cleanups: AfterEachListener[] = [];

      try {
        for (const fn of parentHooks.beforeEachListeners) {
          const cleanupFn = await fn();
          cleanupFn && cleanups.push(cleanupFn);
        }
      } catch (error) {
        result = {
          status: 'fail' as const,
          parentNames: test.parentNames,
          name: test.name,
          errors: formatTestError(error),
          testPath,
        };
      }

      if (result?.status !== 'fail') {
        if (test.fails) {
          try {
            this.beforeRunTest(test, snapshotClient.getSnapshotState(testPath));
            await test.fn?.();
            this.afterRunTest(test);

            result = {
              status: 'fail' as const,
              parentNames: test.parentNames,
              name: test.name,
              testPath,
              errors: [
                {
                  message: 'Expect test to fail',
                },
              ],
            };
          } catch (error) {
            result = {
              status: 'pass' as const,
              parentNames: test.parentNames,
              name: test.name,
              testPath,
            };
          }
        } else {
          try {
            this.beforeRunTest(test, snapshotClient.getSnapshotState(testPath));
            await test.fn?.();
            this.afterRunTest(test);
            result = {
              parentNames: test.parentNames,
              name: test.name,
              status: 'pass' as const,
              testPath,
            };
          } catch (error) {
            result = {
              status: 'fail' as const,
              parentNames: test.parentNames,
              name: test.name,
              errors: formatTestError(error),
              testPath,
            };
          }
        }
      }

      const afterEachFns = [...(parentHooks.afterEachListeners || [])]
        .reverse()
        .concat(cleanups);
      try {
        for (const fn of afterEachFns) {
          await fn();
        }
      } catch (error) {
        result.status = 'fail';
        result.errors ??= [];
        result.errors.push(...formatTestError(error));
      }

      this.resetCurrentTest();

      return result;
    };

    const runTest = async (
      test: Test,
      parentHooks: {
        beforeEachListeners: BeforeEachListener[];
        afterEachListeners: AfterEachListener[];
      },
    ) => {
      if (test.type === 'suite') {
        if (test.tests.length === 0) {
          if (['todo', 'skip'].includes(test.runMode)) {
            defaultStatus = 'skip';
            return;
          }
          if (passWithNoTests) {
            return;
          }
          const noTestError = {
            message: `No test found in suite: ${test.name}`,
            name: 'No tests',
          };

          errors.push(noTestError);
          const result = {
            status: 'fail' as const,
            parentNames: test.parentNames,
            name: test.name,
            testPath,
            errors: [noTestError],
          };
          hooks.onTestCaseResult?.(result);
        }

        // execution order: beforeAll -> beforeEach -> run test case -> afterEach -> afterAll -> beforeAll cleanup
        const cleanups: Array<(ctx: SuiteContext) => void> = [];
        let hasBeforeAllError = false;

        if (['run', 'only'].includes(test.runMode) && test.beforeAllListeners) {
          try {
            for (const fn of test.beforeAllListeners) {
              const cleanupFn = await fn({
                filepath: testPath,
              });
              cleanupFn && cleanups.push(cleanupFn);
            }
          } catch (error) {
            hasBeforeAllError = true;

            errors.push(...formatTestError(error));
          }
        }

        if (hasBeforeAllError) {
          // when has beforeAll error, all test cases should skipped
          markAllTestAsSkipped(test.tests);
        }

        for (const suite of test.tests) {
          await runTest(suite, {
            beforeEachListeners: parentHooks.beforeEachListeners.concat(
              test.beforeEachListeners || [],
            ),
            afterEachListeners: parentHooks.afterEachListeners.concat(
              test.afterEachListeners || [],
            ),
          });
        }

        const afterAllFns = [...(test.afterAllListeners || [])]
          .reverse()
          .concat(cleanups);

        if (['run', 'only'].includes(test.runMode) && afterAllFns.length) {
          try {
            for (const fn of afterAllFns) {
              await fn({
                filepath: testPath,
              });
            }
          } catch (error) {
            // AfterAll failed does not affect test case results
            errors.push(...formatTestError(error));
          }
        }
      } else {
        const start = Date.now();
        let result: TestResult | undefined = undefined;
        let retryCount = 0;

        do {
          const currentResult = await runTestsCase(test, parentHooks);

          result = {
            ...currentResult,
            errors:
              currentResult.status === 'fail' && result && result!.errors
                ? result.errors.concat(...(currentResult.errors || []))
                : currentResult.errors,
          };

          retryCount++;
        } while (retryCount <= retry && result.status === 'fail');

        result.duration = Date.now() - start;
        hooks.onTestCaseResult?.(result);
        results.push(result);
      }
    };

    const start = Date.now();

    if (tests.length === 0) {
      if (passWithNoTests) {
        return {
          testPath,
          name: '',
          status: 'pass',
          results,
        };
      }

      return {
        testPath,
        name: '',
        status: 'fail',
        results,
        errors: [
          {
            message: `No test suites found in file: ${testPath}`,
            name: 'No tests',
          },
        ],
      };
    }

    traverseUpdateTest(tests, testNamePattern);

    for (const test of tests) {
      await runTest(test, {
        beforeEachListeners: [],
        afterEachListeners: [],
      });
    }

    // saves files and returns SnapshotResult
    const snapshotResult = await snapshotClient.finish(testPath);

    return {
      testPath,
      name: '',
      status: errors.length ? 'fail' : getTestStatus(results, defaultStatus),
      results,
      snapshotResult,
      errors,
      duration: Date.now() - start,
    };
  }

  private resetCurrentTest(): void {
    this._test = undefined;
  }

  private setCurrentTest(test: TestCase): void {
    this._test = test;
  }

  getCurrentTest(): TestCase | undefined {
    return this._test;
  }

  private beforeEach(test: TestCase, state: WorkerState, api: Rstest) {
    const {
      runtimeConfig: {
        clearMocks,
        resetMocks,
        restoreMocks,
        unstubEnvs,
        unstubGlobals,
      },
    } = state;

    this.setCurrentTest(test);

    if (restoreMocks) {
      api.rstest.restoreAllMocks();
    } else if (resetMocks) {
      api.rstest.resetAllMocks();
    } else if (clearMocks) {
      api.rstest.clearAllMocks();
    }

    if (unstubEnvs) {
      api.rstest.unstubAllEnvs();
    }

    if (unstubGlobals) {
      api.rstest.unstubAllGlobals();
    }
  }

  private beforeRunTest(test: TestCase, snapshotState: SnapshotState): void {
    setState(
      {
        assertionCalls: 0,
        isExpectingAssertions: false,
        isExpectingAssertionsError: null,
        expectedAssertionsNumber: null,
        expectedAssertionsNumberErrorGen: null,
        testPath: test.filePath,
        snapshotState,
        currentTestName: getTaskNameWithPrefix(test),
      },
      (globalThis as any)[GLOBAL_EXPECT],
    );
  }

  private afterRunTest(test: TestCase): void {
    const {
      assertionCalls,
      expectedAssertionsNumber,
      expectedAssertionsNumberErrorGen,
      isExpectingAssertions,
      isExpectingAssertionsError,
    } = getState((globalThis as any)[GLOBAL_EXPECT]);

    if (test.result?.state === 'fail') {
      throw test.result!.errors;
    }

    if (
      expectedAssertionsNumber !== null &&
      assertionCalls !== expectedAssertionsNumber
    ) {
      throw expectedAssertionsNumberErrorGen!();
    }
    if (isExpectingAssertions === true && assertionCalls === 0) {
      throw isExpectingAssertionsError;
    }
  }
}
