import { GLOBAL_EXPECT, getState, setState } from '@vitest/expect';
import type { SnapshotClient, SnapshotState } from '@vitest/snapshot';
import type {
  AfterEachListener,
  BeforeEachListener,
  CoverageProvider,
  FormattedError,
  MatcherState,
  OnTestFailedHandler,
  OnTestFinishedHandler,
  Rstest,
  RstestExpect,
  RunnerHooks,
  SuiteContext,
  Test,
  TestCase,
  TestContext,
  TestFileResult,
  TestResult,
  TestResultStatus,
  WorkerState,
} from '../../types';
import { SYNTHETIC_STACK_ERROR_MESSAGE } from '../../utils/constants';
import { getFileTaskId, getTaskNameWithPrefix } from '../../utils/helper';
import { createExpect } from '../api/expect';
import { formatTestError, TestSkipError } from '../util';
import type { TaskContext } from '../worker/taskContext';
import { handleFixtures } from './fixtures';
import {
  getTestStatus,
  limitConcurrency,
  markAllTestAsSkipped,
  sanitizeAttemptCount,
  wrapTimeout,
} from './task';

const RealDate = Date;

export class TestRunner {
  /** current test case */
  private _test: TestCase | undefined;
  private workerState: WorkerState | undefined;

  constructor(private readonly taskContext: TaskContext) {}

  async runTests({
    tests,
    testPath,
    state,
    hooks,
    api,
    snapshotClient,
  }: {
    tests: Test[];
    testPath: string;
    state: WorkerState;
    hooks: RunnerHooks;
    snapshotClient: SnapshotClient;
    api: Rstest;
    coverageProvider?: CoverageProvider;
  }): Promise<TestFileResult> {
    this.workerState = state;
    const {
      runtimeConfig: { passWithNoTests, retry, maxConcurrency, bail },
      project,
    } = state;
    const results: TestResult[] = [];
    const errors: FormattedError[] = [];
    let defaultStatus: TestResultStatus = 'pass';

    const runTestsCase = async (
      test: TestCase,
      parentHooks: {
        beforeEachListeners: BeforeEachListener[];
        afterEachListeners: AfterEachListener[];
      },
    ): Promise<TestResult> => {
      if (test.runMode === 'skip') {
        snapshotClient.skipTest(testPath, getTaskNameWithPrefix(test));
        const result = {
          testId: test.testId,
          status: 'skip' as const,
          parentNames: test.parentNames,
          name: test.name,
          testPath,
          project,
        };
        return result;
      }
      if (test.runMode === 'todo') {
        const result = {
          testId: test.testId,
          status: 'todo' as const,
          parentNames: test.parentNames,
          name: test.name,
          testPath,
          project,
        };
        return result;
      }

      let result: TestResult | undefined;

      // `onTestFinished` / `onTestFailed` are registered from inside the test
      // body, so each retry / repeat would otherwise stack new handlers on
      // top of leftovers from prior attempts and rerun them. Snapshot the
      // current lengths and truncate back after the attempt completes.
      const onFinishedSnapshot = test.onFinished.length;
      const onFailedSnapshot = test.onFailed.length;

      this.beforeEach(test, state, api);

      const cleanups: AfterEachListener[] = [];
      const fixtureCleanups: (() => Promise<void>)[] = [];

      let skipped = false;

      const skipResult = (): TestResult => ({
        testId: test.testId,
        status: 'skip' as const,
        parentNames: test.parentNames,
        name: test.name,
        testPath,
        project,
      });

      try {
        await this.beforeRunTest(
          test,
          snapshotClient.getSnapshotState(testPath),
          fixtureCleanups,
        );
      } catch (error) {
        if (error instanceof TestSkipError) {
          skipped = true;
          result = skipResult();
        } else {
          result = {
            testId: test.testId,
            status: 'fail' as const,
            parentNames: test.parentNames,
            name: test.name,
            errors: await formatTestError(error, test),
            testPath,
            project,
          };
        }
      }

      if (!result) {
        try {
          for (const fn of parentHooks.beforeEachListeners) {
            const cleanupFn = await fn(test.context);
            if (cleanupFn) cleanups.push(cleanupFn);
          }
        } catch (error) {
          if (error instanceof TestSkipError) {
            skipped = true;
            result = skipResult();
          } else {
            result = {
              testId: test.testId,
              status: 'fail' as const,
              parentNames: test.parentNames,
              name: test.name,
              errors: await formatTestError(error, test),
              testPath,
              project,
            };
          }
        }
      }

      if (!result) {
        if (test.fails) {
          try {
            await test.fn?.(test.context);
            this.afterRunTest(test);

            result = {
              testId: test.testId,
              status: 'fail' as const,
              parentNames: test.parentNames,
              name: test.name,
              testPath,
              project,
              errors: [
                {
                  message: 'Expect test to fail',
                },
              ],
            };
          } catch (error) {
            if (error instanceof TestSkipError) {
              skipped = true;
              result = skipResult();
            } else {
              result = {
                testId: test.testId,
                project,
                status: 'pass' as const,
                parentNames: test.parentNames,
                name: test.name,
                testPath,
              };
            }
          }
        } else {
          try {
            if (test.fn) {
              const fn = wrapTimeout({
                name: 'test',
                fn: test.fn,
                timeout: test.timeout,
                stackTraceError: test.stackTraceError,
                getAssertionCalls: () => {
                  const expect = (test.context as any)._useLocalExpect
                    ? test.context.expect
                    : (globalThis as any)[GLOBAL_EXPECT];
                  const { assertionCalls } = getState(expect);

                  return assertionCalls;
                },
              });
              await fn(test.context);
            }
            this.afterRunTest(test);
            result = {
              testId: test.testId,
              project,
              parentNames: test.parentNames,
              name: test.name,
              status: 'pass' as const,
              testPath,
            };
          } catch (error) {
            if (error instanceof TestSkipError) {
              skipped = true;
              result = skipResult();
            } else {
              result = {
                testId: test.testId,
                project,
                status: 'fail' as const,
                parentNames: test.parentNames,
                name: test.name,
                errors: await formatTestError(error, test),
                testPath,
              };
            }
          }
        }
      }

      const afterEachFns = [...(parentHooks.afterEachListeners || [])]
        .reverse()
        .concat(cleanups)
        .concat(fixtureCleanups)
        .concat(test.onFinished);

      test.context.task.result = result;
      try {
        for (const fn of afterEachFns) {
          await fn(test.context);
        }
      } catch (error) {
        result.status = 'fail';
        result.errors ??= [];
        result.errors.push(...(await formatTestError(error)));
      }

      if (skipped) {
        snapshotClient.skipTest(testPath, getTaskNameWithPrefix(test));
      }

      if (result.status === 'fail') {
        for (const fn of [...test.onFailed].reverse()) {
          try {
            await fn(test.context);
          } catch (error) {
            result.errors ??= [];
            result.errors.push(...(await formatTestError(error)));
          }
        }
        // should not be updated for snapshots that have not been run when the test run fails
        snapshotClient.skipTest(testPath, getTaskNameWithPrefix(test));
      }

      test.onFinished.length = onFinishedSnapshot;
      test.onFailed.length = onFailedSnapshot;

      this.resetCurrentTest();

      return result;
    };

    const limitMaxConcurrency = limitConcurrency(maxConcurrency);

    const runTests = async (
      allTest: Test[],
      parentHooks: {
        beforeEachListeners: BeforeEachListener[];
        afterEachListeners: AfterEachListener[];
      },
    ): Promise<TestResult[]> => {
      const tests = [...allTest];
      const results: TestResult[] = [];

      while (tests.length) {
        const suite = tests.shift()!;

        if (suite.concurrent) {
          const cases = [suite];
          while (tests[0]?.concurrent) {
            cases.push(tests.shift()!);
          }

          const result = await Promise.all(
            cases.map((test) => {
              if (test.type === 'suite') {
                return runTest(test, parentHooks);
              }
              return limitMaxConcurrency(() => runTest(test, parentHooks));
            }),
          );
          results.push(...result);

          continue;
        }

        const result = await runTest(suite, parentHooks);
        results.push(result);
      }
      return results;
    };

    const runTest = async (
      test: Test,
      parentHooks: {
        beforeEachListeners: BeforeEachListener[];
        afterEachListeners: AfterEachListener[];
      },
    ): Promise<TestResult> => {
      let result: TestResult = {
        testId: test.testId,
        status: 'skip',
        parentNames: test.parentNames,
        name: test.name,
        testPath,
        project,
        duration: 0,
        errors: [],
      };

      if (bail && (await hooks.getCountOfFailedTests()) >= bail) {
        defaultStatus = 'skip';
        return result;
      }

      if (test.type === 'suite') {
        result = await this.taskContext.run(
          {
            taskId: test.testId,
            taskName: test.name,
            taskParentNames: test.parentNames,
            taskType: 'suite',
            testPath,
          },
          async () => {
            const start = RealDate.now();

            hooks.onTestSuiteStart?.({
              parentNames: test.parentNames,
              name: test.name,
              testPath,
              project: test.project,
              testId: test.testId,
              type: 'suite',
              location: test.location,
              runMode: test.runMode,
            });

            if (test.tests.length === 0) {
              if (['todo', 'skip'].includes(test.runMode)) {
                defaultStatus = 'skip';
                hooks.onTestSuiteResult?.(result);
                return result;
              }
              if (passWithNoTests) {
                result.status = 'pass';
                hooks.onTestSuiteResult?.(result);
                return result;
              }
              const noTestError = {
                message: `No test found in suite: ${test.name}`,
                name: 'No tests',
              };

              result.errors?.push(noTestError);
            }

            const cleanups: ((ctx: SuiteContext) => void)[] = [];
            let hasBeforeAllError = false;

            if (
              ['run', 'only'].includes(test.runMode) &&
              test.beforeAllListeners
            ) {
              try {
                for (const fn of test.beforeAllListeners) {
                  const cleanupFn = await fn({
                    filepath: testPath,
                  });
                  if (cleanupFn) cleanups.push(cleanupFn);
                }
              } catch (error) {
                hasBeforeAllError = true;
                result.errors?.push(...(await formatTestError(error)));
              }
            }

            if (hasBeforeAllError) {
              markAllTestAsSkipped(test.tests);
            }

            const results = await runTests(test.tests, {
              beforeEachListeners: parentHooks.beforeEachListeners.concat(
                test.beforeEachListeners || [],
              ),
              afterEachListeners: parentHooks.afterEachListeners.concat(
                test.afterEachListeners || [],
              ),
            });

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
                result.errors?.push(...(await formatTestError(error)));
              }
            }

            result.duration = RealDate.now() - start;
            result.status = result.errors?.length
              ? 'fail'
              : getTestStatus(results, defaultStatus);
            hooks.onTestSuiteResult?.(result);

            return result;
          },
        );

        errors.push(...(result.errors || []));
      } else {
        result = await this.taskContext.run(
          {
            taskId: test.testId,
            taskName: test.name,
            taskParentNames: test.parentNames,
            taskType: 'case',
            testPath,
          },
          async () => {
            const start = RealDate.now();
            // Per-test override wins over config.retry. `retry` (the runtime
            // config) is the suite-wide default.
            const retryBudget = sanitizeAttemptCount(test.retry ?? retry);
            // Treat negative / NaN / fractional repeats as 0 so the outer
            // loop always runs at least once. Without this, an invalid
            // `repeats` value would silently report the case as skipped.
            const repeats = sanitizeAttemptCount(test.repeats ?? 0);
            let totalRetryCount = 0;
            // `retryErrors` aggregates every failed attempt across all
            // repeats so a final pass can surface the full flakiness picture
            // via `result.retryErrors`.
            const retryErrors: FormattedError[] = [];

            hooks.onTestCaseStart?.({
              testId: test.testId,
              startTime: start,
              testPath: test.testPath,
              name: test.name,
              timeout: test.timeout,
              parentNames: test.parentNames,
              project: test.project,
              type: 'case',
              location: test.location,
              runMode: test.runMode,
            });

            for (let repeat = 0; repeat <= repeats; repeat++) {
              let retryCount = 0;
              // Scoped per repeat so a terminal failure does not get
              // attributed errors from earlier repeats that already passed.
              const repeatRetryErrors: FormattedError[] = [];
              do {
                const currentResult = await runTestsCase(test, parentHooks);

                if (currentResult.status === 'fail') {
                  repeatRetryErrors.push(
                    ...(currentResult.errors || []).map((error) => ({
                      ...error,
                      retryCount:
                        retryBudget > 0 ? retryCount : error.retryCount,
                    })),
                  );
                }

                result = {
                  ...currentResult,
                  errors:
                    currentResult.status === 'fail'
                      ? [...repeatRetryErrors]
                      : currentResult.errors,
                };

                retryCount++;
              } while (retryCount <= retryBudget && result.status === 'fail');

              totalRetryCount += retryCount - 1;
              retryErrors.push(...repeatRetryErrors);

              // `repeats` semantics: any failure short-circuits remaining
              // repeats. Pass/skip/todo continue to the next repeat.
              if (result.status === 'fail') {
                break;
              }
            }

            result.duration = RealDate.now() - start;
            result.retryCount = totalRetryCount;
            if (result.status === 'pass' && retryErrors.length > 0) {
              result.retryErrors = retryErrors;
            }
            result.heap = state.runtimeConfig.logHeapUsage
              ? process.memoryUsage().heapUsed
              : undefined;
            hooks.onTestCaseResult?.(result);
            results.push(result);
            return result;
          },
        );
      }
      return result;
    };

    const start = RealDate.now();

    if (tests.length === 0) {
      if (passWithNoTests) {
        return {
          testId: getFileTaskId(testPath),
          project,
          testPath,
          name: '',
          status: 'pass',
          results,
        };
      }

      return {
        testId: getFileTaskId(testPath),
        project,
        testPath,
        name: '',
        status: 'fail',
        results,
        heap: state.runtimeConfig.logHeapUsage
          ? process.memoryUsage().heapUsed
          : undefined,
        errors: [
          {
            message: `No test suites found in file: ${testPath}`,
            name: 'No tests',
          },
        ],
      };
    }

    await runTests(tests, {
      beforeEachListeners: [],
      afterEachListeners: [],
    });

    // saves files and returns SnapshotResult
    const snapshotResult = await snapshotClient.finish(testPath);

    this.taskContext.setFallback({
      taskId: getFileTaskId(testPath),
      taskType: 'file',
      testPath,
    });

    try {
      return {
        testId: getFileTaskId(testPath),
        project,
        testPath,
        name: '',
        heap: state.runtimeConfig.logHeapUsage
          ? process.memoryUsage().heapUsed
          : undefined,
        status: errors.length ? 'fail' : getTestStatus(results, defaultStatus),
        results,
        snapshotResult,
        errors,
        duration: RealDate.now() - start,
      };
    } finally {
      this.taskContext.setFallback(undefined);
    }
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

  private createTestContext(test: TestCase): TestContext {
    const context = (() => {
      throw new Error('done() callback is deprecated, use promise instead');
    }) as unknown as TestContext;

    let _expect: RstestExpect | undefined;

    const current = this._test;

    context.task = {
      id: test.testId,
      name: test.name,
      filepath: test.testPath,
    };

    Object.defineProperty(context, 'expect', {
      get: () => {
        if (!_expect) {
          _expect = createExpect({
            getWorkerState: () => this.workerState!,
            getCurrentTest: () => current,
          });
        }
        return _expect;
      },
    });

    Object.defineProperty(context, 'skip', {
      value: () => {
        throw new TestSkipError('Test skipped');
      },
    });

    Object.defineProperty(context, '_useLocalExpect', {
      get() {
        return _expect != null;
      },
    });

    Object.defineProperty(context, 'onTestFinished', {
      get: () => {
        return (fn: OnTestFinishedHandler, timeout?: number) => {
          this.onTestFinished(current, fn, timeout);
        };
      },
    });

    Object.defineProperty(context, 'onTestFailed', {
      get: () => {
        return (fn: OnTestFailedHandler, timeout?: number) => {
          this.onTestFailed(current, fn, timeout);
        };
      },
    });

    return context;
  }

  onTestFinished(
    test: TestCase | undefined,
    fn: OnTestFinishedHandler,
    timeout?: number,
  ): void {
    if (!test) {
      throw new Error('onTestFinished() can only be called inside a test');
    }
    test.onFinished.push(
      wrapTimeout({
        name: 'onTestFinished hook',
        fn,
        timeout: timeout || this.workerState!.runtimeConfig.hookTimeout,
        stackTraceError: new Error(SYNTHETIC_STACK_ERROR_MESSAGE),
      }),
    );
  }

  onTestFailed(
    test: TestCase | undefined,
    fn: OnTestFailedHandler,
    timeout?: number,
  ): void {
    if (!test) {
      throw new Error('onTestFailed() can only be called inside a test');
    }
    test.onFailed.push(
      wrapTimeout({
        name: 'onTestFailed hook',
        fn,
        timeout: timeout || this.workerState!.runtimeConfig.hookTimeout,
        stackTraceError: new Error(SYNTHETIC_STACK_ERROR_MESSAGE),
      }),
    );
  }

  private async beforeRunTest(
    test: TestCase,
    snapshotState: SnapshotState,
    fixtureCleanups: (() => Promise<void>)[],
  ): Promise<void> {
    setState<MatcherState>(
      {
        assertionCalls: 0,
        isExpectingAssertions: false,
        isExpectingAssertionsError: null,
        expectedAssertionsNumber: null,
        expectedAssertionsNumberErrorGen: null,
        testPath: test.testPath,
        snapshotState,
        currentTestName: getTaskNameWithPrefix(test),
      },
      (globalThis as any)[GLOBAL_EXPECT],
    );

    const context = this.createTestContext(test);

    // create test context
    Object.defineProperty(test, 'context', {
      value: context,
      enumerable: false,
    });

    await handleFixtures(test, context, fixtureCleanups);
  }

  private afterRunTest(test: TestCase): void {
    // @ts-expect-error
    const expect = test.context._useLocalExpect
      ? test.context.expect
      : (globalThis as any)[GLOBAL_EXPECT];

    const {
      assertionCalls,
      expectedAssertionsNumber,
      expectedAssertionsNumberErrorGen,
      isExpectingAssertions,
      isExpectingAssertionsError,
    } = getState(expect);

    if (test.result?.state === 'fail') {
      throw test.result.errors;
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
