import { GLOBAL_EXPECT, getState, setState } from '@vitest/expect';
import type { SnapshotState } from '@vitest/snapshot';
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
import { getSnapshotClient } from '../api/snapshot';
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
  }: {
    tests: Test[];
    testPath: string;
    state: WorkerState;
    hooks: RunnerHooks;
    api: Rstest;
    coverageProvider?: CoverageProvider;
  }): Promise<TestFileResult> {
    this.workerState = state;
    const {
      runtimeConfig: { passWithNoTests, retry, maxConcurrency },
      project,
      snapshotOptions,
    } = state;
    const results: TestResult[] = [];
    const errors: FormattedError[] = [];
    let defaultStatus: TestResultStatus = 'pass';

    hooks.onTestFileStart?.({ testPath });
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
        snapshotClient.skipTest(testPath, getTaskNameWithPrefix(test));
        const result = {
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
          errors: formatTestError(error, test),
          testPath,
          project,
        };
      }

      if (result?.status !== 'fail') {
        if (test.fails) {
          try {
            const fixtureCleanups = await this.beforeRunTest(
              test,
              snapshotClient.getSnapshotState(testPath),
            );
            cleanups.push(...fixtureCleanups);
            await test.fn?.(test.context);
            this.afterRunTest(test);

            result = {
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
              project,
              status: 'pass' as const,
              parentNames: test.parentNames,
              name: test.name,
              testPath,
            };
          }
        } else {
          try {
            const fixtureCleanups = await this.beforeRunTest(
              test,
              snapshotClient.getSnapshotState(testPath),
            );
            cleanups.push(...fixtureCleanups);
            await test.fn?.(test.context);
            this.afterRunTest(test);
            result = {
              project,
              parentNames: test.parentNames,
              name: test.name,
              status: 'pass' as const,
              testPath,
            };
          } catch (error) {
            result = {
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

      try {
        for (const fn of afterEachFns) {
          await fn({ task: { result } });
        }
      } catch (error) {
        result.status = 'fail';
        result.errors ??= [];
        result.errors.push(...formatTestError(error));
      }

      if (result.status === 'fail') {
        for (const fn of [...test.onFailed].reverse()) {
          try {
            await fn({ task: { result } });
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
    ) => {
      const tests = [...allTest];

      while (tests.length) {
        const suite = tests.shift()!;

        if (suite.concurrent) {
          const cases = [suite];
          while (tests[0]?.concurrent) {
            cases.push(tests.shift()!);
          }

          await Promise.all(
            cases.map((test) => {
              if (test.type === 'suite') {
                return runTest(test, parentHooks);
              }
              return limitMaxConcurrency(() => runTest(test, parentHooks));
            }),
          );

          continue;
        }

        await runTest(suite, parentHooks);
      }
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
            project,
          };
          hooks.onTestCaseResult?.(result);
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

            errors.push(...formatTestError(error));
          }
        }

        if (hasBeforeAllError) {
          // when has beforeAll error, all test cases should skipped
          markAllTestAsSkipped(test.tests);
        }

        await runTests(test.tests, {
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
            errors.push(...formatTestError(error));
          }
        }
      } else {
        const start = RealDate.now();
        let result: TestResult | undefined;
        let retryCount = 0;

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
        hooks.onTestCaseResult?.(result);
        results.push(result);
      }
    };

    const start = RealDate.now();

    if (tests.length === 0) {
      if (passWithNoTests) {
        return {
          project,
          testPath,
          name: '',
          status: 'pass',
          results,
        };
      }

      return {
        project,
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

    await runTests(tests, {
      beforeEachListeners: [],
      afterEachListeners: [],
    });

    // saves files and returns SnapshotResult
    const snapshotResult = await snapshotClient.finish(testPath);

    return {
      project,
      testPath,
      name: '',
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

  private createTestContext(): TestContext {
    const context = (() => {
      throw new Error('done() callback is deprecated, use promise instead');
    }) as unknown as TestContext;

    let _expect: RstestExpect | undefined;

    const current = this._test;

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

    const context = this.createTestContext();

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
