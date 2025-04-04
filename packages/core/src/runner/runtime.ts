import type { MaybePromise } from 'src/types/utils';
import type {
  AfterAllListener,
  Test,
  TestCase,
  TestSuite,
  TestSuiteListeners,
} from '../types';

type ListenersKey<T extends TestSuiteListeners> =
  T extends `${infer U}Listeners` ? U : never;
function registerTestSuiteListener(
  suite: TestSuite,
  key: ListenersKey<TestSuiteListeners>,
  fn: (...args: any[]) => any,
): void {
  const listenersKey = `${key}Listeners` as TestSuiteListeners;
  suite[listenersKey] ??= [];
  suite[listenersKey].push(fn);
}

export class RunnerRuntime {
  /** all test cases */
  private tests: Test[] = [];
  /** current test case */
  private _test: TestCase | undefined;
  /** current test suite, could be undefined if no explicit suite declared */
  // private _suite: TestSuite | undefined;
  /** a calling stack of the current test suites and case */
  private _currentTest: Test[] = [];
  private sourcePath: string;

  constructor(sourcePath: string) {
    this.sourcePath = sourcePath;
  }

  afterAll(fn: AfterAllListener): MaybePromise<void> {
    const currentSuite = this.getCurrentSuite();
    registerTestSuiteListener(currentSuite!, 'afterAll', fn);
  }

  getDefaultRootSuite(): TestSuite {
    return {
      description: 'Rstest:_internal_root_suite',
      tests: [],
      type: 'suite',
    };
  }

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

  addTestCase(test: Omit<TestCase, 'filePath'>): void {
    this.addTest({
      ...test,
      filePath: this.sourcePath,
    });
    this.resetCurrentTest();
  }

  /**
   * Ensure that the current test suite is not empty and is used
   * for `beforeAll` or `afterAll` at the file scope.
   */
  ensureRootSuite(): void {
    if (this._currentTest.length === 0) {
      this.addTest(this.getDefaultRootSuite());
    }
  }

  it(description: string, fn: () => void | Promise<void>): void {
    this.addTestCase({ description, fn, type: 'case' });
  }

  getCurrentTest(): TestCase | undefined {
    return this._test;
  }

  getCurrentSuite(): TestSuite {
    this.ensureRootSuite();

    for (let i = this._currentTest.length - 1; i >= 0; i--) {
      const test = this._currentTest[i];
      if (test!.type === 'suite') {
        return test!;
      }
    }

    throw new Error('Expect to find a suite, but got undefined');
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
