import { GLOBAL_EXPECT, getState, setState } from '@vitest/expect';
import { getSnapshotClient } from '../api/snapshot';
import type {
  RunnerHooks,
  Test,
  TestCase,
  TestError,
  TestFileResult,
  TestResult,
  TestResultStatus,
  TestSuite,
  WorkerState,
} from '../types';
import { ROOT_SUITE_NAME } from '../utils';
import { formatTestError } from '../utils/runtime';

const getTestStatus = (results: TestResult[]): TestResultStatus => {
  if (results.length === 0) {
    return 'pass';
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
export const traverseUpdateTestRunMode = (testSuite: TestSuite): void => {
  if (testSuite.tests.length === 0) {
    testSuite.runMode = 'skip';
    return;
  }

  const tests = testSuite.tests.map((test) => {
    if (test.type === 'case') {
      return test;
    }
    traverseUpdateTestRunMode(test);
    return test;
  });

  const hasRunTest = tests.some((test) => test.runMode === 'run');

  if (hasRunTest) {
    testSuite.runMode = 'run';
    return;
  }

  const allTodoTest = tests.every((test) => test.runMode === 'todo');

  testSuite.runMode = allTodoTest ? 'todo' : 'skip';
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

    hooks.onTestFileStart?.({ filePath: testPath });
    const snapshotClient = getSnapshotClient();

    await snapshotClient.setup(testPath, snapshotOptions);

    const runTest = async (test: Test, prefixes: string[] = []) => {
      if (test.type === 'suite') {
        if (test.tests.length === 0) {
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

        if (test.runMode === 'run' && test.beforeAllListeners) {
          for (const fn of test.beforeAllListeners) {
            try {
              await fn();
            } catch (error) {
              // TODO handle error
            }
          }
        }

        for (const suite of test.tests) {
          await runTest(
            suite,
            test.name === ROOT_SUITE_NAME ? prefixes : [...prefixes, test.name],
          );
        }

        if (test.runMode === 'run' && test.afterAllListeners) {
          for (const fn of test.afterAllListeners) {
            try {
              await fn();
            } catch (error) {
              // TODO handle error
            }
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

        let result: TestResult;
        this.setCurrentTest(test, prefixes);

        if (test.fails) {
          try {
            this.beforeRunTest(testPath);
            await test.fn();
            this.afterRunTest();

            result = {
              status: 'fail' as const,
              prefixes,
              name: test.name,
              duration: Date.now() - start,
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
              duration: Date.now() - start,
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
              duration: Date.now() - start,
              testPath,
            };
          } catch (error) {
            result = {
              status: 'fail' as const,
              prefixes,
              name: test.name,
              duration: Date.now() - start,
              errors: formatTestError(error),
              testPath,
            };
          }
        }

        this.resetCurrentTest();

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
      await runTest(test);
    }

    // saves files and returns SnapshotResult
    const snapshotResult = await snapshotClient.finish(testPath);

    return {
      testPath,
      name: '',
      status: errors.length ? 'fail' : getTestStatus(results),
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
