import { GLOBAL_EXPECT, getState, setState } from '@vitest/expect';
import type { TestResult, TestSuite, TestSuiteResult } from '../types';

export class TestRunner {
  async runTest(suites: TestSuite[], testPath: string): Promise<TestResult> {
    const results: TestSuiteResult[] = [];
    if (suites.length === 0) {
      console.error(`No test suites found in file: ${testPath}\n`);
      return {
        name: 'test',
        status: 'fail',
        results,
      };
    }

    for (const suite of suites) {
      console.log(`Suite: ${suite.description}`);

      for (const test of suite.tests) {
        if (test.skipped) {
          console.log(`  - ${test.description}`);
          results.push({ status: 'skip', name: test.description });
          continue;
        }
        if (test.todo) {
          console.log(`  - ${test.description}`);
          results.push({ status: 'todo', name: test.description });
          continue;
        }
        if (test.fails) {
          try {
            this.beforeRunTest(testPath);
            await test.fn();
            this.afterRunTest();

            results.push({ status: 'fail', name: test.description });
            console.log(`  ✗ ${test.description}`);
            console.error('    Expect test to fail');
          } catch (error) {
            results.push({ status: 'pass', name: test.description });
            console.log(`  ✓ ${test.description}`);
          }
          continue;
        }
        try {
          this.beforeRunTest(testPath);
          await test.fn();
          this.afterRunTest();
          results.push({ status: 'pass', name: test.description });
          console.log(`  ✓ ${test.description}`);
        } catch (error) {
          results.push({ status: 'fail', name: test.description });
          console.log(`  ✗ ${test.description}`);
          console.error(`    ${error}`);
        }
      }
      console.log('');
    }

    return {
      name: 'test',
      status: results.some((result) => result.status === 'fail')
        ? 'fail'
        : results.every((result) => result.status === 'todo')
          ? 'todo'
          : results.every((result) => result.status === 'skip')
            ? 'skip'
            : 'pass',
      results,
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
