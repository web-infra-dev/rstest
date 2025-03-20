import { GLOBAL_EXPECT, getState, setState } from '@vitest/expect';
// TODO: This is a minimal runner, in order to run the overall process
import type {
  TestCase,
  TestResult,
  TestSuite,
  TestSuiteResult,
} from '../types';
import { setCurrentTest } from './state';

class TestRunner {
  public suites: TestSuite[] = [];

  describe(description: string, fn: () => void): void {
    const currentSuite: TestSuite = {
      description,
      tests: [],
    };

    this.suites.push(currentSuite);
    fn();
  }

  setCurrentTest(test: TestCase): void {
    const currentSuite = this.suites[this.suites.length - 1]!;
    currentSuite.tests.push(test);
    setCurrentTest(test);
  }

  it(description: string, fn: () => void | Promise<void>): void {
    if (this.suites.length === 0) {
      throw new Error('Test case must be defined within a suite');
    }

    this.setCurrentTest({ description, fn });
  }

  skip(description: string, fn: () => void | Promise<void>): void {
    if (this.suites.length === 0) {
      throw new Error('Test case must be defined within a suite');
    }

    this.setCurrentTest({ description, fn, skipped: true });
  }

  todo(description: string, fn: () => void | Promise<void>): void {
    if (this.suites.length === 0) {
      throw new Error('Test case must be defined within a suite');
    }

    this.setCurrentTest({ description, fn, todo: true });
  }

  fails(description: string, fn: () => void | Promise<void>): void {
    if (this.suites.length === 0) {
      throw new Error('Test case must be defined within a suite');
    }

    this.setCurrentTest({ description, fn, fails: true });
  }

  async run(testPath: string): Promise<TestResult> {
    const results: TestSuiteResult[] = [];
    if (this.suites.length === 0) {
      console.error(`No test suites found in file: ${testPath}\n`);
      return {
        name: 'test',
        status: 'fail',
        results,
      };
    }

    for (const suite of this.suites) {
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

  beforeRunTest(testPath: string): void {
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

  afterRunTest(): void {
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

export const runner: TestRunner = new TestRunner();

export const describe: (description: string, fn: () => void) => void =
  runner.describe.bind(runner);

type TestFn = (description: string, fn: () => void | Promise<void>) => void;

type TestAPI = TestFn & {
  fails: TestFn;
  todo: TestFn;
  skip: TestFn;
};

const it = runner.it.bind(runner) as TestAPI;

it.fails = runner.fails.bind(runner);
it.todo = runner.todo.bind(runner);
it.skip = runner.skip.bind(runner);
export { it };
