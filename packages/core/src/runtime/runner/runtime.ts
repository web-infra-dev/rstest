import type { MaybePromise } from 'src/types/utils';
import type {
  AfterAllListener,
  AfterEachListener,
  BeforeAllListener,
  BeforeEachListener,
  DescribeAPI,
  DescribeBaseAPI,
  DescribeEachFn,
  RunnerAPI,
  Test,
  TestAPI,
  TestBaseAPI,
  TestCase,
  TestEachFn,
  TestRunMode,
  TestSuite,
} from '../../types';
import { ROOT_SUITE_NAME, castArray } from '../../utils';
import { formatName } from '../util';
import { registerTestSuiteListener, wrapTimeout } from './task';

type CollectStatus = 'lazy' | 'running';

export class RunnerRuntime {
  /** all test cases */
  private tests: Test[] = [];
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
  private defaultHookTimeout = 5_000;
  private defaultTestTimeout;

  constructor({
    sourcePath,
    testTimeout,
  }: {
    testTimeout: number;
    sourcePath: string;
  }) {
    this.sourcePath = sourcePath;
    this.defaultTestTimeout = testTimeout;
  }

  afterAll(
    fn: AfterAllListener,
    timeout: number = this.defaultHookTimeout,
  ): MaybePromise<void> {
    const currentSuite = this.getCurrentSuite();
    registerTestSuiteListener(
      currentSuite!,
      'afterAll',
      wrapTimeout({
        name: 'afterAll hook',
        fn,
        timeout,
        stackTraceError: new Error('STACK_TRACE_ERROR'),
      }),
    );
  }

  beforeAll(
    fn: BeforeAllListener,
    timeout: number = this.defaultHookTimeout,
  ): MaybePromise<void> {
    const currentSuite = this.getCurrentSuite();
    registerTestSuiteListener(
      currentSuite!,
      'beforeAll',
      wrapTimeout({
        name: 'beforeAll hook',
        fn,
        timeout,
        stackTraceError: new Error('STACK_TRACE_ERROR'),
      }),
    );
  }

  afterEach(
    fn: AfterEachListener,
    timeout: number = this.defaultHookTimeout,
  ): MaybePromise<void> {
    const currentSuite = this.getCurrentSuite();
    registerTestSuiteListener(
      currentSuite!,
      'afterEach',
      wrapTimeout({
        name: 'afterEach hook',
        fn,
        timeout,
        stackTraceError: new Error('STACK_TRACE_ERROR'),
      }),
    );
  }

  beforeEach(
    fn: BeforeEachListener,
    timeout: number = this.defaultHookTimeout,
  ): MaybePromise<void> {
    const currentSuite = this.getCurrentSuite();
    registerTestSuiteListener(
      currentSuite!,
      'beforeEach',
      wrapTimeout({
        name: 'beforeEach hook',
        fn,
        timeout,
        stackTraceError: new Error('STACK_TRACE_ERROR'),
      }),
    );
  }

  private getDefaultRootSuite(): TestSuite {
    return {
      runMode: 'run',
      name: ROOT_SUITE_NAME,
      tests: [],
      type: 'suite',
    };
  }

  describe(
    name: string,
    fn?: () => MaybePromise<void>,
    runMode: TestRunMode = 'run',
    each = false,
  ): void {
    const currentSuite: TestSuite = {
      name,
      runMode,
      tests: [],
      type: 'suite',
      each,
    };

    if (!fn) {
      this.addTest(currentSuite);
      this.resetCurrentTest();
      return;
    }

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

  private resetCurrentTest(): void {
    this._currentTest.pop();
  }

  addTest(test: TestSuite | TestCase): void {
    if (this._currentTest.length === 0) {
      this.tests.push(test);
    } else {
      const current = this._currentTest[this._currentTest.length - 1]!;

      if (current.each || current.inTestEach) {
        test.inTestEach = true;
      }

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
  private ensureRootSuite(): void {
    if (this._currentTest.length === 0) {
      this.addTest(this.getDefaultRootSuite());
    }
  }

  it({
    name,
    fn,
    timeout = this.defaultTestTimeout,
    runMode = 'run',
    fails = false,
    each = false,
    concurrent = false,
  }: {
    name: string;
    fn?: () => void | Promise<void>;
    timeout?: number;
    runMode?: TestRunMode;
    each?: boolean;
    fails?: boolean;
    concurrent?: boolean;
  }): void {
    this.addTestCase({
      name,
      fn: fn
        ? wrapTimeout({
            name: 'test',
            fn,
            timeout,
            stackTraceError: new Error('STACK_TRACE_ERROR'),
          })
        : fn,
      runMode,
      type: 'case',
      timeout,
      concurrent,
      each,
      fails,
    });
  }

  describeEach(
    cases: Parameters<DescribeEachFn>[0],
    runMode: TestRunMode = 'run',
  ): ReturnType<DescribeEachFn> {
    return (name: string, fn) => {
      for (let i = 0; i < cases.length; i++) {
        // TODO: template string table.
        const param = cases[i]!;
        const params = castArray(param) as Parameters<typeof fn>;

        this.describe(
          formatName(name, param, i),
          () => fn?.(...params),
          runMode,
          true,
        );
      }
    };
  }

  each({
    cases,
    runMode = 'run',
    concurrent = false,
  }: {
    cases: Parameters<TestEachFn>[0];
    runMode?: TestRunMode;
    concurrent?: boolean;
  }): ReturnType<TestEachFn> {
    return (name, fn, timeout = this.defaultTestTimeout) => {
      for (let i = 0; i < cases.length; i++) {
        // TODO: template string table.
        const param = cases[i]!;
        const params = castArray(param) as Parameters<typeof fn>;

        this.it({
          name: formatName(name, param, i),
          fn: () => fn?.(...params),
          timeout,
          runMode,
          each: true,
          concurrent,
        });
      }
    };
  }

  private getCurrentSuite(): TestSuite {
    this.ensureRootSuite();

    for (let i = this._currentTest.length - 1; i >= 0; i--) {
      const test = this._currentTest[i];
      if (test!.type === 'suite') {
        return test!;
      }
    }

    throw new Error('Expect to find a suite, but got undefined');
  }
}

export const createRuntimeAPI = ({
  sourcePath,
  testTimeout,
}: { sourcePath: string; testTimeout: number }): {
  api: RunnerAPI;
  instance: RunnerRuntime;
} => {
  const runtimeInstance: RunnerRuntime = new RunnerRuntime({
    sourcePath,
    testTimeout,
  });

  // TODO: optimize chainable API

  const it = ((name, fn, timeout) =>
    runtimeInstance.it({ name, fn, timeout })) as TestAPI;
  it.fails = (name, fn, timeout) =>
    runtimeInstance.it({ name, fn, timeout, fails: true });
  it.each = ((cases: any) => runtimeInstance.each({ cases })) as TestEachFn;
  it.todo = (name, fn, timeout) =>
    runtimeInstance.it({ name, fn, timeout, runMode: 'todo' });

  it.concurrent = ((name, fn, timeout) =>
    runtimeInstance.it({ name, fn, timeout, concurrent: true })) as TestBaseAPI;
  it.concurrent.fails = ((name, fn, timeout) =>
    runtimeInstance.it({
      name,
      fn,
      timeout,
      concurrent: true,
      fails: true,
    })) as TestBaseAPI;
  it.concurrent.each = ((cases: any) =>
    runtimeInstance.each({ cases, concurrent: true })) as TestEachFn;

  it.skip = ((name, fn, timeout) =>
    runtimeInstance.it({ name, fn, timeout, runMode: 'skip' })) as TestBaseAPI;
  it.skip.fails = (name, fn, timeout) =>
    runtimeInstance.it({ name, fn, timeout, runMode: 'skip', fails: true });
  it.skip.each = ((cases: any) =>
    runtimeInstance.each({ cases, runMode: 'skip' })) as TestEachFn;

  it.only = ((name, fn, timeout) =>
    runtimeInstance.it({ name, fn, timeout, runMode: 'only' })) as TestBaseAPI;
  it.only.fails = (name, fn, timeout) =>
    runtimeInstance.it({ name, fn, timeout, runMode: 'only', fails: true });
  it.only.each = ((cases: any) =>
    runtimeInstance.each({ cases, runMode: 'only' })) as TestEachFn;

  it.runIf = (condition: boolean) => (condition ? it : it.skip) as TestBaseAPI;
  it.skipIf = (condition: boolean) => (condition ? it.skip : it) as TestBaseAPI;

  const describe = ((name, fn) =>
    runtimeInstance.describe(name, fn)) as DescribeAPI;

  describe.only = ((name, fn) =>
    runtimeInstance.describe(name, fn, 'only')) as DescribeBaseAPI;
  describe.only.each = ((cases: any) =>
    runtimeInstance.describeEach(cases, 'only')) as DescribeEachFn;
  describe.todo = (name, fn) => runtimeInstance.describe(name, fn, 'todo');
  describe.skip = ((name, fn) =>
    runtimeInstance.describe(name, fn, 'skip')) as DescribeBaseAPI;
  describe.skip.each = ((cases: any) =>
    runtimeInstance.describeEach(cases, 'skip')) as DescribeEachFn;

  describe.skipIf = (condition: boolean) =>
    (condition ? describe.skip : describe) as DescribeBaseAPI;
  describe.runIf = (condition: boolean) =>
    (condition ? describe : describe.skip) as DescribeBaseAPI;

  describe.each = runtimeInstance.describeEach.bind(
    runtimeInstance,
  ) as DescribeEachFn;

  return {
    api: {
      describe,
      it,
      test: it,
      afterAll: runtimeInstance.afterAll.bind(runtimeInstance),
      beforeAll: runtimeInstance.beforeAll.bind(runtimeInstance),
      afterEach: runtimeInstance.afterEach.bind(runtimeInstance),
      beforeEach: runtimeInstance.beforeEach.bind(runtimeInstance),
    },
    instance: runtimeInstance,
  };
};
