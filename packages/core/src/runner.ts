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

  async run(): Promise<void> {
    for (const suite of this.suites) {
      console.log(`Suite: ${suite.description}`);

      for (const test of suite.tests) {
        if (test.skipped) {
          console.log(`  - ${test.description}`);
          continue;
        }
        try {
          await test.fn();
          console.log(`  ✓ ${test.description}`);
        } catch (error) {
          console.log(`  ✗ ${test.description}`);
          console.error(`    ${error}`);
        }
      }
      console.log('');
    }
  }
}

export const runner: TestRunner = new TestRunner();

export const describe: (description: string, fn: () => void) => void =
  runner.describe.bind(runner);

export const it: (description: string, fn: () => void | Promise<void>) => void =
  runner.it.bind(runner);
