// TODO: This is a minimal runner, in order to run the overall process
type TestCase = {
  description: string;
  fn: () => void | Promise<void>;
  skipped?: boolean;
  todo?: boolean;
  fails?: boolean;
};

type TestSuite = {
  description: string;
  tests: TestCase[];
};

export type TestSuiteResult = {
  status: 'skip' | 'pass' | 'fail' | 'todo';
  name: string;
};

export type TestResult = {
  status: 'skip' | 'pass' | 'fail' | 'todo';
  name: string;
  results: TestSuiteResult[];
};

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

  it(description: string, fn: () => void | Promise<void>): void {
    if (this.suites.length === 0) {
      throw new Error('Test case must be defined within a suite');
    }

    const currentSuite = this.suites[this.suites.length - 1]!;
    currentSuite.tests.push({ description, fn });
  }

  skip(description: string, fn: () => void | Promise<void>): void {
    if (this.suites.length === 0) {
      throw new Error('Test case must be defined within a suite');
    }

    const currentSuite = this.suites[this.suites.length - 1]!;
    currentSuite.tests.push({ description, fn, skipped: true });
  }

  todo(description: string, fn: () => void | Promise<void>): void {
    if (this.suites.length === 0) {
      throw new Error('Test case must be defined within a suite');
    }

    const currentSuite = this.suites[this.suites.length - 1]!;
    currentSuite.tests.push({ description, fn, todo: true });
  }

  fails(description: string, fn: () => void | Promise<void>): void {
    if (this.suites.length === 0) {
      throw new Error('Test case must be defined within a suite');
    }

    const currentSuite = this.suites[this.suites.length - 1]!;
    currentSuite.tests.push({ description, fn, fails: true });
  }

  async run(originPath: string): Promise<TestResult> {
    const results: TestSuiteResult[] = [];
    if (this.suites.length === 0) {
      console.error(`No test suites found in file: ${originPath}\n`);
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
            await test.fn();
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
          await test.fn();
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
