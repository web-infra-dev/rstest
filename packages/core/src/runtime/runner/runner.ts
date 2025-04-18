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
  WorkerState,
} from '../../types';
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

  async runTests(
    tests: Test[],
    testPath: string,
    state: WorkerState,
    hooks: RunnerHooks,
  ): Promise<TestFileResult> {
    const {
      normalizedConfig: { passWithNoTests, testNamePattern },
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
        const cleanups: Array<() => void> = [];
        let hasBeforeAllError = false;

        if (['run', 'only'].includes(test.runMode) && test.beforeAllListeners) {
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
            parentNames: test.parentNames,
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
            parentNames: test.parentNames,
            name: test.name,
            testPath,
          };
          hooks.onTestCaseResult?.(result);
          results.push(result);
          return;
        }

        let result: TestResult | undefined = undefined;
        this.setCurrentTest(test);

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
            duration: Date.now() - start,
          };
        }

        if (result?.status !== 'fail') {
          if (test.fails) {
            try {
              this.beforeRunTest(testPath);
              await test.fn?.();
              this.afterRunTest();

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
              this.beforeRunTest(testPath);
              await test.fn?.();
              this.afterRunTest();
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
