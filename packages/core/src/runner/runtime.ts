import type { TestCase, TestSuite } from '../types';

export class RunnerRuntime {
  private suites: TestSuite[] = [];
  private _test: TestCase | undefined;

  describe(description: string, fn: () => void): void {
    const currentSuite: TestSuite = {
      description,
      tests: [],
    };

    this.suites.push(currentSuite);
    fn();
  }

  getTests(): TestSuite[] {
    return this.suites;
  }

  setCurrentTest(test: TestCase): void {
    const currentSuite = this.suites[this.suites.length - 1]!;
    currentSuite.tests.push(test);
    this._test = test;
  }

  it(description: string, fn: () => void | Promise<void>): void {
    if (this.suites.length === 0) {
      throw new Error('Test case must be defined within a suite');
    }

    this.setCurrentTest({ description, fn });
  }

  getCurrentTest(): TestCase | undefined {
    return this._test;
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
}
