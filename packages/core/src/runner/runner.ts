import { GLOBAL_EXPECT, getState, setState } from '@vitest/expect';
import { NodeSnapshotEnvironment } from '@vitest/snapshot/environment';
import { getSnapshotClient } from '../api/snapshot';
import type {
  RunnerHooks,
  Test,
  TestResult,
  TestResultStatus,
  TestSummaryResult,
  WorkerContext,
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

export class TestRunner {
  async runTests(
    tests: Test[],
    testPath: string,
    context: WorkerContext,
    hooks: RunnerHooks,
  ): Promise<TestSummaryResult> {
    const {
      normalizedConfig: { passWithNoTests },
    } = context;
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

    await snapshotClient.setup(testPath, {
      updateSnapshot: 'all',
      snapshotEnvironment: new NodeSnapshotEnvironment(),
    });

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
        if (test.fails) {
          try {
            this.beforeRunTest(testPath);
            await test.fn();
            this.afterRunTest();

            const result = {
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
            hooks.onTestCaseResult?.(result);

            results.push(result);
          } catch (error) {
            const result = {
              status: 'pass' as const,
              prefix,
              name: test.description,
              testPath,
              duration: Date.now() - start,
            };
            hooks.onTestCaseResult?.(result);

            results.push(result);
          }
          return;
        }
        try {
          this.beforeRunTest(testPath);
          await test.fn();
          this.afterRunTest();
          const result = {
            status: 'pass' as const,
            prefix,
            name: test.description,
            duration: Date.now() - start,
            testPath,
          };
          hooks.onTestCaseResult?.(result);

          results.push(result);
        } catch (error) {
          const result = {
            status: 'fail' as const,
            prefix,
            name: test.description,
            duration: Date.now() - start,
            errors: Array.isArray(error) ? error : [error],
            testPath,
          };
          hooks.onTestCaseResult?.(result);

          results.push(result);
        }
      }
    };

    const start = Date.now();

    for (const test of tests) {
      await runTest(test);
    }

    // saves files and returns SnapshotResult
    await snapshotClient.finish(testPath);

    return {
      testPath,
      name: 'test',
      status: getTestStatus(results),
      results,
      duration: Date.now() - start,
    };
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
