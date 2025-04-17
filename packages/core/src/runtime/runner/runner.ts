import { GLOBAL_EXPECT, getState, setState } from '@vitest/expect';
import type {
  AfterEachListener,
  BeforeEachListener,
  RunnerHooks,
  Test,
  TestCase,
  TestError,
  TestFileResult,
  TestResult,
  TestResultStatus,
  TestRunMode,
  TestSuite,
  WorkerState,
} from '../../types';
import { ROOT_SUITE_NAME } from '../../utils';
import { getSnapshotClient } from '../api/snapshot';
import { formatTestError } from '../util';

const getTestStatus = (
  results: TestResult[],
  defaultStatus: TestResultStatus,
): TestResultStatus => {
  if (results.length === 0) {
    return defaultStatus;
  }
  return results.some((result) => result.status === 'fail')
    ? 'fail'
    : results.every((result) => result.status === 'todo')
      ? 'todo'
      : results.every((result) => result.status === 'skip')
        ? 'skip'
        : 'pass';
};

/**
 * sets the runMode of the test suite based on the runMode of its tests
 * - if some tests are 'run', set the suite to 'run'
 * - if all tests are 'todo', set the suite to 'todo'
 * - if all tests are 'skip', set the suite to 'skip'
 */
export const traverseUpdateTestRunMode = (
  testSuite: TestSuite,
  parentRunMode: TestRunMode = 'run',
): void => {
  if (testSuite.tests.length === 0) {
    return;
  }

  if (['skip', 'todo'].includes(parentRunMode)) {
    testSuite.runMode = parentRunMode;
  }

  const tests = testSuite.tests.map((test) => {
    if (test.type === 'case') {
      if (['skip', 'todo'].includes(testSuite.runMode)) {
        test.runMode = testSuite.runMode;
      }
      return test;
    }
    traverseUpdateTestRunMode(test, testSuite.runMode);
    return test;
  });

  if (testSuite.runMode !== 'run') {
    return;
  }

  const hasRunTest = tests.some((test) => test.runMode === 'run');

  if (hasRunTest) {
    testSuite.runMode = 'run';
    return;
  }

  const allTodoTest = tests.every((test) => test.runMode === 'todo');

  testSuite.runMode = allTodoTest ? 'todo' : 'skip';
};

const markAllTestAsSkipped = (test: Test[]): void => {
  for (const t of test) {
    t.runMode = 'skip';
    if (t.type === 'suite') {
      markAllTestAsSkipped(t.tests);
    }
  }
};

export class TestRunner {
  /** current test case */
  private _test: TestCase | undefined;

  async runTests(
    tests: Test[],
    testPath: string,
    state: WorkerState,
    hooks: RunnerHooks,
  ): Promise<TestFileResult> {
    const {
      normalizedConfig: { passWithNoTests },
      snapshotOptions,
    } = state;
    const results: TestResult[] = [];
    const errors: TestError[] = [];
    let defaultStatus: TestResultStatus = 'pass';

    hooks.onTestFileStart?.({ filePath: testPath });
    const snapshotClient = getSnapshotClient();

    await snapshotClient.setup(testPath, snapshotOptions);

    const runTest = async (
      test: Test,
      prefixes: string[],
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
            prefixes,
            name: test.name,
            testPath,
            errors: [noTestError],
          };
          hooks.onTestCaseResult?.(result);
        }

        // execution order: beforeAll -> beforeEach -> run test case -> afterEach -> afterAll -> beforeAll cleanup
        const cleanups: Array<() => void> = [];
        let hasBeforeAllError = false;

        if (test.runMode === 'run' && test.beforeAllListeners) {
          try {
            for (const fn of test.beforeAllListeners) {
              const cleanupFn = await fn();
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
          await runTest(
            suite,
            test.name === ROOT_SUITE_NAME ? prefixes : [...prefixes, test.name],
            {
              beforeEachListeners: parentHooks.beforeEachListeners.concat(
                test.beforeEachListeners || [],
              ),
              afterEachListeners: parentHooks.afterEachListeners.concat(
                test.afterEachListeners || [],
              ),
            },
          );
        }

        const afterAllFns = [...(test.afterAllListeners || [])]
          .reverse()
          .concat(cleanups);

        if (test.runMode === 'run' && afterAllFns.length) {
          try {
            for (const fn of afterAllFns) {
              await fn();
            }
          } catch (error) {
            // AfterAll failed does not affect test case results
            errors.push(...formatTestError(error));
          }
        }
      } else {
        const start = Date.now();
        if (test.runMode === 'skip') {
          const result = {
            status: 'skip' as const,
            prefixes,
            name: test.name,
            testPath,
          };
          hooks.onTestCaseResult?.(result);
          results.push(result);
          return;
        }
        if (test.runMode === 'todo') {
          const result = {
            status: 'todo' as const,
            prefixes,
            name: test.name,
            testPath,
          };
          hooks.onTestCaseResult?.(result);
          results.push(result);
          return;
        }

        let result: TestResult | undefined = undefined;
        this.setCurrentTest(test, prefixes);

        const cleanups: AfterEachListener[] = [];

        try {
          for (const fn of parentHooks.beforeEachListeners) {
            const cleanupFn = await fn();
            cleanupFn && cleanups.push(cleanupFn);
          }
        } catch (error) {
          result = {
            status: 'fail' as const,
            prefixes,
            name: test.name,
            errors: formatTestError(error),
            testPath,
            duration: Date.now() - start,
          };
        }

        if (result?.status !== 'fail') {
          if (test.fails) {
            try {
              this.beforeRunTest(testPath);
              await test.fn();
              this.afterRunTest();

              result = {
                status: 'fail' as const,
                prefixes,
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
                prefixes,
                name: test.name,
                testPath,
              };
            }
          } else {
            try {
              this.beforeRunTest(testPath);
              await test.fn();
              this.afterRunTest();
              result = {
                status: 'pass' as const,
                prefixes,
                name: test.name,
                testPath,
              };
            } catch (error) {
              result = {
                status: 'fail' as const,
                prefixes,
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

    this.updateTaskModes(tests);

    for (const test of tests) {
      await runTest(test, [], {
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

  private updateTaskModes(tests: Test[]) {
    for (const test of tests) {
      if (test.type === 'suite') {
        traverseUpdateTestRunMode(test);
      }
    }
  }

  private resetCurrentTest(): void {
    this._test = undefined;
  }

  private setCurrentTest(test: TestCase, prefixes: string[]): void {
    this._test = {
      ...test,
      prefixes,
    };
  }

  getCurrentTest(): TestCase | undefined {
    return this._test;
  }

  private beforeRunTest(testPath: string): void {
    setState(
      {
        assertionCalls: 0,
        isExpectingAssertions: false,
        isExpectingAssertionsError: null,
        expectedAssertionsNumber: null,
        expectedAssertionsNumberErrorGen: null,
        testPath,
      },
      (globalThis as any)[GLOBAL_EXPECT],
    );
  }

  private afterRunTest(): void {
    const {
      assertionCalls,
      expectedAssertionsNumber,
      expectedAssertionsNumberErrorGen,
      isExpectingAssertions,
      isExpectingAssertionsError,
    } = getState((globalThis as any)[GLOBAL_EXPECT]);
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
