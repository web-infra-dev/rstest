import type { MaybePromise } from 'src/types/utils';
import type {
  AfterAllListener,
  BeforeAllListener,
  Test,
  TestCase,
  TestSuite,
  TestSuiteListeners,
} from '../types';
import { ROOT_SUITE_NAME } from '../utils';

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

type CollectStatus = 'lazy' | 'running';

export class RunnerRuntime {
  /** all test cases */
  private tests: Test[] = [];
  /** current test suite, could be undefined if no explicit suite declared */
  // private _suite: TestSuite | undefined;
  /** a calling stack of the current test suites and case */
  private _currentTest: Test[] = [];
  private sourcePath: string;

  /**
   * Collect test status:
   * - lazy: add fn to `currentCollectList` to delay collection;
   * - running: collect it immediately.
   */
  private collectStatus: CollectStatus = 'lazy';
  private currentCollectList: Array<() => MaybePromise<void>> = [];

  constructor(sourcePath: string) {
    this.sourcePath = sourcePath;
  }

  afterAll(fn: AfterAllListener): MaybePromise<void> {
    const currentSuite = this.getCurrentSuite();
    registerTestSuiteListener(currentSuite!, 'afterAll', fn);
  }

  beforeAll(fn: BeforeAllListener): MaybePromise<void> {
    const currentSuite = this.getCurrentSuite();
    registerTestSuiteListener(currentSuite!, 'beforeAll', fn);
  }

  getDefaultRootSuite(): TestSuite {
    return {
      runMode: 'run',
      name: ROOT_SUITE_NAME,
      tests: [],
      type: 'suite',
    };
  }

  describe(name: string, fn: () => MaybePromise<void>): void {
    const currentSuite: TestSuite = {
      name,
      runMode: 'run',
      tests: [],
      type: 'suite',
    };

    // describe may be async, so we need to collect it later
    this.collectStatus = 'lazy';

    this.currentCollectList.push(async () => {
      this.addTest(currentSuite);
      const result = fn();
      if (result instanceof Promise) {
        await result;
      }
      // call current collect immediately
      await this.collectCurrentTest();
      this.resetCurrentTest();
    });
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
  }
  private async collectCurrentTest(): Promise<void> {
    const currentCollectList = this.currentCollectList;
    // reset currentCollectList
    this.currentCollectList = [];
    while (currentCollectList.length > 0) {
      this.collectStatus = 'running';
      const fn = currentCollectList.shift()!;
      await fn();
    }
  }

  async getTests(): Promise<Test[]> {
    while (this.currentCollectList.length > 0) {
      await this.collectCurrentTest();
    }

    return this.tests;
  }

  addTestCase(test: Omit<TestCase, 'filePath'>): void {
    if (this.collectStatus === 'lazy') {
      this.currentCollectList.push(() => {
        this.addTest({
          ...test,
          filePath: this.sourcePath,
        });
        this.resetCurrentTest();
      });
    } else {
      this.addTest({
        ...test,
        filePath: this.sourcePath,
      });
      this.resetCurrentTest();
    }
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

  it(name: string, fn: () => void | Promise<void>): void {
    this.addTestCase({ name, fn, runMode: 'run', type: 'case' });
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

  skip(name: string, fn: () => void | Promise<void>): void {
    this.addTestCase({
      name,
      fn,
      skipped: true,
      runMode: 'skip',
      type: 'case',
    });
  }

  todo(name: string, fn: () => void | Promise<void>): void {
    this.addTestCase({ name, fn, todo: true, runMode: 'todo', type: 'case' });
  }

  fails(name: string, fn: () => void | Promise<void>): void {
    this.addTestCase({ name, fn, fails: true, runMode: 'run', type: 'case' });
  }
}
