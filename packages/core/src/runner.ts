// TODO: This is a minimal runner, in order to run the overall process
type TestCase = {
  description: string;
  fn: () => void | Promise<void>;
  skipped?: boolean;
};

type TestSuite = {
  description: string;
  tests: TestCase[];
};

type TestSuiteResult = {
  status: 'skip' | 'pass' | 'fail';
  name: string;
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

  async run(): Promise<TestSuiteResult[]> {
    const results: TestSuiteResult[] = [];
    for (const suite of this.suites) {
      console.log(`Suite: ${suite.description}`);

      for (const test of suite.tests) {
        if (test.skipped) {
          console.log(`  - ${test.description}`);
          results.push({ status: 'skip', name: test.description });
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
    return results;
  }
}

export const runner: TestRunner = new TestRunner();

export const describe: (description: string, fn: () => void) => void =
  runner.describe.bind(runner);

export const it: (description: string, fn: () => void | Promise<void>) => void =
  runner.it.bind(runner);
