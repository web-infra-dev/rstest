import type { Test, TestCase, TestSuite } from '../types';

export class RunnerRuntime {
  private tests: Array<Test> = [];
  private _test: TestCase | undefined;

  private _currentTest: Test[] = [];

  describe(description: string, fn: () => void): void {
    const currentSuite: TestSuite = {
      description,
      tests: [],
      type: 'suite',
    };
    this.addTest(currentSuite);
    fn();
    this.resetCurrentTest();
  }

  resetCurrentTest(): void {
    this._currentTest.pop();
  }

  addTest(test: TestSuite | TestCase): void {
    if (this._currentTest.length === 0) {
      this.tests.push(test);
    } else {
      const current = this._currentTest[this._currentTest.length - 1]!;

      if (current.type === 'case') {
        throw new Error(
          'Calling the test function inside another test function is not allowed. Please put it inside "describe" so it can be properly collected.',
        );
      }
      current.tests.push(test);
    }

    this._currentTest.push(test);

    if (test.type === 'case') {
      this._test = test;
    }
  }

  getTests(): Test[] {
    return this.tests;
  }

  addTestCase(test: TestCase): void {
    this.addTest(test);
    this.resetCurrentTest();
  }

  it(description: string, fn: () => void | Promise<void>): void {
    this.addTestCase({ description, fn, type: 'case' });
  }

  getCurrentTest(): TestCase | undefined {
    return this._test;
  }

  skip(description: string, fn: () => void | Promise<void>): void {
    this.addTestCase({ description, fn, skipped: true, type: 'case' });
  }

  todo(description: string, fn: () => void | Promise<void>): void {
    this.addTestCase({ description, fn, todo: true, type: 'case' });
  }

  fails(description: string, fn: () => void | Promise<void>): void {
    this.addTestCase({ description, fn, fails: true, type: 'case' });
  }
}
