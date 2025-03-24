import { relative } from 'node:path';
import { GLOBAL_EXPECT, getState, setState } from '@vitest/expect';
import type { Test, TestResult, TestSuiteResult } from '../types';

export class TestRunner {
  async runTests(
    tests: Test[],
    testPath: string,
    rootPath: string,
  ): Promise<TestResult> {
    const results: TestSuiteResult[] = [];
    if (tests.length === 0) {
      console.error(`No test suites found in file: ${testPath}\n`);
      return {
        name: 'test',
        status: 'fail',
        results,
      };
    }

    console.log('Run test file:', relative(rootPath, testPath));

    const runTest = async (test: Test, prefix = '') => {
      if (test.type === 'suite') {
        if (test.tests.length === 0) {
          console.error(`No test found in suite : ${test.description}\n`);
          results.push({ status: 'fail', name: test.description });
        }

        for (const suite of test.tests) {
          await runTest(suite, `${prefix}${test.description} > `);
        }
      } else {
        if (test.skipped) {
          console.log(`  - ${prefix}${test.description}`);
          results.push({ status: 'skip', name: test.description });
          return;
        }
        if (test.todo) {
          console.log(`  - ${prefix}${test.description}`);
          results.push({ status: 'todo', name: test.description });
          return;
        }
        if (test.fails) {
          try {
            this.beforeRunTest(testPath);
            await test.fn();
            this.afterRunTest();

            results.push({ status: 'fail', name: test.description });
            console.log(`  ✗ ${prefix}${test.description}`);
            console.error('    Expect test to fail');
          } catch (error) {
            results.push({ status: 'pass', name: test.description });
            console.log(`  ✓ ${prefix}${test.description}`);
          }
          return;
        }
        try {
          this.beforeRunTest(testPath);
          await test.fn();
          this.afterRunTest();
          results.push({ status: 'pass', name: test.description });
          console.log(`  ✓ ${prefix}${test.description}`);
        } catch (error) {
          results.push({ status: 'fail', name: test.description });
          console.log(`  ✗ ${prefix}${test.description}`);
          console.error(`    ${error}`);
        }
      }
    };

    for (const test of tests) {
      await runTest(test);
    }
    console.log('');

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
