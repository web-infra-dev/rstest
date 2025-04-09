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
  WorkerState,
} from '../types';

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

const formatTestError = (err: any): TestError[] => {
  const errors = Array.isArray(err) ? err : [err];

  return errors.map((error) => {
    const errObj: TestError = {
      ...error,
      // Some error attributes cannot be enumerated
      message: error.message,
      name: err.name,
      stack: err.stack,
    };
    return errObj;
  });
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

    const runTest = async (test: Test, prefix = '') => {
      if (test.type === 'suite') {
        if (test.tests.length === 0) {
          if (passWithNoTests) {
            console.warn(`   No test found in suite: ${test.description}\n`);
            return;
          }
          const result = {
            status: 'fail' as const,
            prefix,
            name: test.description,
            testPath,
          };
          hooks.onTestCaseResult?.(result);
        }

        for (const suite of test.tests) {
          await runTest(suite, `${prefix}${test.description} > `);
        }

        if (test.afterAllListeners) {
          for (const fn of test.afterAllListeners) {
            try {
              await fn();
            } catch (error) {}
          }
        }
      } else {
        const start = Date.now();
        if (test.skipped) {
          const result = {
            status: 'skip' as const,
            prefix,
            name: test.description,
            testPath,
          };
          hooks.onTestCaseResult?.(result);
          results.push(result);
          return;
        }
        if (test.todo) {
          const result = {
            status: 'todo' as const,
            prefix,
            name: test.description,
            testPath,
          };
          hooks.onTestCaseResult?.(result);
          results.push(result);
          return;
        }

        let result: TestResult;
        this.setCurrentTest(test);

        if (test.fails) {
          try {
            this.beforeRunTest(testPath);
            await test.fn();
            this.afterRunTest();

            result = {
              status: 'fail' as const,
              prefix,
              name: test.description,
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
              prefix,
              name: test.description,
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
              prefix,
              name: test.description,
              duration: Date.now() - start,
              testPath,
            };
          } catch (error) {
            result = {
              status: 'fail' as const,
              prefix,
              name: test.description,
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

  private setCurrentTest(test: TestCase): void {
    this._test = test;
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
