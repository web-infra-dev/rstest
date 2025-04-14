import { GLOBAL_EXPECT, getState, setState } from '@vitest/expect';
import type { SnapshotState } from '@vitest/snapshot';
import { getSnapshotClient } from '../api/snapshot';
import type {
  RunnerHooks,
  Test,
  TestCase,
  TestFileResult,
  TestResult,
  TestResultStatus,
  WorkerState,
} from '../types';
import { ROOT_SUITE_NAME, getTaskNameWithPrefix } from '../utils';
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
    if (tests.length === 0) {
      if (passWithNoTests) {
        return {
          testPath,
          name: 'test',
          status: 'pass',
          results,
        };
      }
      console.error(`No test suites found in file: ${testPath}\n`);
      return {
        testPath,
        name: 'test',
        status: 'fail',
        results,
      };
    }

    hooks.onTestFileStart?.({ filePath: testPath });
    const snapshotClient = getSnapshotClient();

    await snapshotClient.setup(testPath, snapshotOptions);

    const runTest = async (test: Test, prefixes: string[] = []) => {
      if (test.type === 'suite') {
        if (test.tests.length === 0) {
          if (passWithNoTests) {
            console.warn(`   No test found in suite: ${test.name}\n`);
            return;
          }
          const result = {
            status: 'fail' as const,
            prefixes,
            name: test.name,
            testPath,
          };
          hooks.onTestCaseResult?.(result);
        }

        if (test.beforeAllListeners) {
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

        if (test.afterAllListeners) {
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
        if (test.skipped) {
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
        if (test.todo) {
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
            this.beforeRunTest(test, snapshotClient.getSnapshotState(testPath));
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
            this.beforeRunTest(test, snapshotClient.getSnapshotState(testPath));
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

    for (const test of tests) {
      await runTest(test);
    }

    // saves files and returns SnapshotResult
    const snapshotResult = await snapshotClient.finish(testPath);

    return {
      testPath,
      name: 'test',
      status: getTestStatus(results),
      results,
      snapshotResult,
      duration: Date.now() - start,
    };
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
