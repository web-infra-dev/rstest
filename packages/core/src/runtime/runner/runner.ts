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
import { getTaskNameWithPrefix } from '../../utils';
import { createExpect } from '../api/expect';
import { formatTestError } from '../util';
import { handleFixtures } from './fixtures';
import {
  getTestStatus,
  limitConcurrency,
  markAllTestAsSkipped,
  wrapTimeout,
} from './task';

const RealDate = Date;

export class TestRunner {
  /** current test case */
  private _test: TestCase | undefined;
  private workerState: WorkerState | undefined;

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

      this.beforeEach(test, state, api);

      const cleanups: AfterEachListener[] = [];

      const fixtureCleanups = await this.beforeRunTest(
        test,
        snapshotClient.getSnapshotState(testPath),
      );
      cleanups.push(...fixtureCleanups);

      try {
        for (const fn of parentHooks.beforeEachListeners) {
          const cleanupFn = await fn(test.context);
          cleanupFn && cleanups.push(cleanupFn);
        }
      } catch (error) {
        result = {
          testId: test.testId,
          status: 'fail' as const,
          parentNames: test.parentNames,
          name: test.name,
          errors: formatTestError(error, test),
          testPath,
          project,
        };
      }

      if (result?.status !== 'fail') {
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
          } catch (_err) {
            result = {
              testId: test.testId,
              project,
              status: 'pass' as const,
              parentNames: test.parentNames,
              name: test.name,
              testPath,
            };
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
            result = {
              testId: test.testId,
              project,
              status: 'fail' as const,
              parentNames: test.parentNames,
              name: test.name,
              errors: formatTestError(error, test),
              testPath,
            };
          }
        }
      }

      const afterEachFns = [...(parentHooks.afterEachListeners || [])]
        .reverse()
        .concat(cleanups)
        .concat(test.onFinished);

      test.context.task.result = result;
      try {
        for (const fn of afterEachFns) {
          await fn(test.context);
        }
      } catch (error) {
        result.status = 'fail';
        result.errors ??= [];
        result.errors.push(...formatTestError(error));
      }

      if (result.status === 'fail') {
        for (const fn of [...test.onFailed].reverse()) {
          try {
            await fn(test.context);
          } catch (error) {
            result.errors ??= [];
            result.errors.push(...formatTestError(error));
          }
        }
      }

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

        // execution order: beforeAll -> beforeEach -> run test case -> afterEach -> afterAll -> beforeAll cleanup
        const cleanups: ((ctx: SuiteContext) => void)[] = [];
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

            result.errors?.push(...formatTestError(error));
          }
        }

        if (hasBeforeAllError) {
          // when has beforeAll error, all test cases should skipped
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
            // AfterAll failed does not affect test case results
            result.errors?.push(...formatTestError(error));
          }
        }
        result.duration = RealDate.now() - start;
        result.status = result.errors?.length
          ? 'fail'
          : getTestStatus(results, defaultStatus);
        hooks.onTestSuiteResult?.(result);

        errors.push(...(result.errors || []));
      } else {
        const start = RealDate.now();
        let retryCount = 0;
        // Call onTestCaseStart hook before running the test
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

        do {
          const currentResult = await runTestsCase(test, parentHooks);

          result = {
            ...currentResult,
            errors:
              currentResult.status === 'fail' && result && result.errors
                ? result.errors.concat(...(currentResult.errors || []))
                : currentResult.errors,
          };

          retryCount++;
        } while (retryCount <= retry && result.status === 'fail');

        result.duration = RealDate.now() - start;
        result.retryCount = retryCount - 1;
        result.heap = state.runtimeConfig.logHeapUsage
          ? process.memoryUsage().heapUsed
          : undefined;
        hooks.onTestCaseResult?.(result);
        results.push(result);
      }
      return result;
    };

    const start = RealDate.now();

    if (tests.length === 0) {
      if (passWithNoTests) {
        return {
          testId: '0',
          project,
          testPath,
          name: '',
          status: 'pass',
          results,
        };
      }

      return {
        testId: '0',
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

    return {
      testId: '0',
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

    context.task = { name: test.name };

    Object.defineProperty(context, 'expect', {
      get: () => {
        if (!_expect) {
          _expect = createExpect({
            workerState: this.workerState!,
            getCurrentTest: () => current,
          });
        }
        return _expect;
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
        stackTraceError: new Error('STACK_TRACE_ERROR'),
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
        stackTraceError: new Error('STACK_TRACE_ERROR'),
      }),
    );
  }

  private async beforeRunTest(
    test: TestCase,
    snapshotState: SnapshotState,
  ): Promise<(() => Promise<void>)[]> {
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

    const { cleanups } = await handleFixtures(test, context);

    // create test context
    Object.defineProperty(test, 'context', {
      value: context,
      enumerable: false,
    });

    return cleanups;
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
