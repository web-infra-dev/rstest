import type {
  AfterAllListener,
  AfterEachListener,
  BeforeAllListener,
  BeforeEachListener,
  DescribeAPI,
  DescribeEachFn,
  DescribeForFn,
  Fixtures,
  MaybePromise,
  NormalizedFixtures,
  RunnerAPI,
  RuntimeConfig,
  Test,
  TestAPI,
  TestAPIs,
  TestCallbackFn,
  TestCase,
  TestEachFn,
  TestForFn,
  TestRunMode,
  TestSuite,
} from '../../types';
import { castArray, ROOT_SUITE_NAME } from '../../utils';
import { formatName, TestRegisterError } from '../util';
import { normalizeFixtures } from './fixtures';
import { registerTestSuiteListener, wrapTimeout } from './task';

type CollectStatus = 'lazy' | 'running';

export class RunnerRuntime {
  /** all test cases */
  private tests: Test[] = [];
  /** a calling stack of the current test suites and case */
  private _currentTest: Test[] = [];
  private testPath: string;
  private status: 'running' | 'collect' = 'collect';

  /**
   * Collect test status:
   * - lazy: add fn to `currentCollectList` to delay collection;
   * - running: collect it immediately.
   */
  private collectStatus: CollectStatus = 'lazy';
  private currentCollectList: (() => MaybePromise<void>)[] = [];
  private runtimeConfig;
  private project: string;

  constructor({
    testPath,
    runtimeConfig,
    project,
  }: {
    testPath: string;
    runtimeConfig: RuntimeConfig;
    project: string;
  }) {
    this.project = project;
    this.testPath = testPath;
    this.runtimeConfig = runtimeConfig;
  }

  updateStatus(status: 'running' | 'collect'): void {
    this.status = status;
  }

  private checkStatus(name: string, type: 'case' | 'suite'): void {
    if (this.status === 'running') {
      const error = new TestRegisterError(
        `${type === 'case' ? 'Test' : 'Describe'} '${name}' cannot run`,
      );

      throw error;
    }
  }

  afterAll(
    fn: AfterAllListener,
    timeout: number = this.runtimeConfig.hookTimeout,
  ): MaybePromise<void> {
    const currentSuite = this.getCurrentSuite();
    registerTestSuiteListener(
      currentSuite,
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
    timeout: number = this.runtimeConfig.hookTimeout,
  ): MaybePromise<void> {
    const currentSuite = this.getCurrentSuite();
    registerTestSuiteListener(
      currentSuite,
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
    timeout: number = this.runtimeConfig.hookTimeout,
  ): MaybePromise<void> {
    const currentSuite = this.getCurrentSuite();
    registerTestSuiteListener(
      currentSuite,
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
    timeout: number = this.runtimeConfig.hookTimeout,
  ): MaybePromise<void> {
    const currentSuite = this.getCurrentSuite();
    registerTestSuiteListener(
      currentSuite,
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
      project: this.project,
      runMode: 'run',
      testPath: this.testPath,
      name: ROOT_SUITE_NAME,
      tests: [],
      type: 'suite',
    };
  }

  describe({
    name,
    fn,
    runMode = 'run',
    each = false,
    concurrent,
    sequential,
  }: {
    name: string;
    fn?: () => MaybePromise<void>;
    runMode?: TestRunMode;
    each?: boolean;
    concurrent?: boolean;
    sequential?: boolean;
  }): void {
    this.checkStatus(name, 'suite');
    const currentSuite: TestSuite = {
      project: this.project,
      name,
      runMode,
      tests: [],
      type: 'suite',
      each,
      testPath: this.testPath,
      concurrent,
      sequential,
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

      if (current.concurrent && test.sequential !== true) {
        test.concurrent = true;
      }

      if (current.sequential && test.concurrent !== true) {
        test.sequential = true;
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

  addTestCase(test: Omit<TestCase, 'testPath' | 'context'>): void {
    if (this.collectStatus === 'lazy') {
      this.currentCollectList.push(() => {
        this.addTest({
          ...test,
          testPath: this.testPath,
          context: undefined!,
        });
        this.resetCurrentTest();
      });
    } else {
      this.addTest({
        ...test,
        testPath: this.testPath,
        context: undefined!,
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
    originalFn = fn,
    fixtures,
    timeout = this.runtimeConfig.testTimeout,
    runMode = 'run',
    fails = false,
    each = false,
    concurrent,
    sequential,
  }: {
    name: string;
    fixtures?: NormalizedFixtures;
    originalFn?: TestCallbackFn;
    fn?: TestCallbackFn;
    timeout?: number;
    runMode?: TestRunMode;
    each?: boolean;
    fails?: boolean;
    concurrent?: boolean;
    sequential?: boolean;
  }): void {
    this.checkStatus(name, 'case');
    this.addTestCase({
      project: this.project,
      name,
      originalFn,
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
      fixtures,
      concurrent,
      sequential,
      each,
      fails,
      onFinished: [],
      onFailed: [],
    });
  }

  describeEach({
    cases,
    ...options
  }: {
    cases: Parameters<DescribeEachFn>[0];
    runMode?: TestRunMode;
    concurrent?: boolean;
    sequential?: boolean;
  }): ReturnType<DescribeEachFn> {
    return (name: string, fn) => {
      for (let i = 0; i < cases.length; i++) {
        // TODO: template string table.
        const param = cases[i]!;
        const params = castArray(param) as Parameters<typeof fn>;

        this.describe({
          name: formatName(name, param, i),
          fn: () => fn?.(...params),
          ...options,
          each: true,
        });
      }
    };
  }

  describeFor({
    cases,
    ...options
  }: {
    cases: Parameters<DescribeForFn>[0];
    runMode?: TestRunMode;
    concurrent?: boolean;
    sequential?: boolean;
  }): ReturnType<DescribeForFn> {
    return (name: string, fn) => {
      for (let i = 0; i < cases.length; i++) {
        // TODO: template string table.
        const param = cases[i]!;

        this.describe({
          name: formatName(name, param, i),
          fn: () => fn?.(param),
          ...options,
          each: true,
        });
      }
    };
  }

  each({
    cases,
    ...options
  }: {
    cases: Parameters<TestEachFn>[0];
    runMode?: TestRunMode;
    fails?: boolean;
    concurrent?: boolean;
    sequential?: boolean;
  }): ReturnType<TestEachFn> {
    return (name, fn, timeout = this.runtimeConfig.testTimeout) => {
      for (let i = 0; i < cases.length; i++) {
        // TODO: template string table.
        const param = cases[i]!;
        const params = castArray(param) as Parameters<typeof fn>;

        this.it({
          name: formatName(name, param, i),
          originalFn: fn,
          fn: () => fn?.(...params),
          timeout,
          ...options,
          each: true,
        });
      }
    };
  }

  for({
    cases,
    ...options
  }: {
    cases: Parameters<TestForFn>[0];
    fails?: boolean;
    runMode?: TestRunMode;
    concurrent?: boolean;
    sequential?: boolean;
  }): ReturnType<TestEachFn> {
    return (name, fn, timeout = this.runtimeConfig.testTimeout) => {
      for (let i = 0; i < cases.length; i++) {
        // TODO: template string table.
        const param = cases[i]!;

        this.it({
          name: formatName(name, param, i),
          originalFn: fn,
          fn: (context) => fn?.(param, context),
          timeout,
          ...options,
          each: true,
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
  testPath,
  runtimeConfig,
  project,
}: {
  testPath: string;
  runtimeConfig: RuntimeConfig;
  project: string;
}): {
  api: Omit<RunnerAPI, 'onTestFinished' | 'onTestFailed'>;
  instance: RunnerRuntime;
} => {
  const runtimeInstance: RunnerRuntime = new RunnerRuntime({
    project,
    testPath,
    runtimeConfig,
  });

  const createTestAPI = (
    options: {
      concurrent?: boolean;
      sequential?: boolean;
      fails?: boolean;
      fixtures?: NormalizedFixtures;
      runMode?: 'skip' | 'only' | 'todo';
    } = {},
  ): TestAPI => {
    const testFn = ((name, fn, timeout) =>
      runtimeInstance.it({
        name,
        fn,
        timeout,
        ...options,
      })) as TestAPI;

    for (const { name, overrides } of [
      { name: 'fails', overrides: { fails: true } },
      { name: 'concurrent', overrides: { concurrent: true } },
      { name: 'sequential', overrides: { sequential: true } },
      { name: 'skip', overrides: { runMode: 'skip' as const } },
      { name: 'todo', overrides: { runMode: 'todo' as const } },
      { name: 'only', overrides: { runMode: 'only' as const } },
    ]) {
      Object.defineProperty(testFn, name, {
        get: () => {
          return createTestAPI({ ...options, ...overrides });
        },
        enumerable: true,
      });
    }

    testFn.runIf = (condition: boolean) => (condition ? testFn : testFn.skip);

    testFn.skipIf = (condition: boolean) => (condition ? testFn.skip : testFn);

    testFn.each = ((cases: any) =>
      runtimeInstance.each({
        cases,
        ...options,
      })) as TestEachFn;

    testFn.for = ((cases: any) =>
      runtimeInstance.for({
        cases,
        ...options,
      })) as TestForFn;

    return testFn;
  };

  const it = createTestAPI() as TestAPIs;

  it.extend = ((fixtures: Fixtures): TestAPIs => {
    const extend = (
      fixtures: Fixtures,
      extendFixtures?: NormalizedFixtures,
    ) => {
      const normalizedFixtures = normalizeFixtures(fixtures, extendFixtures);
      const api = createTestAPI({ fixtures: normalizedFixtures }) as TestAPIs;
      api.extend = ((subFixtures: Fixtures) => {
        return extend(subFixtures, normalizedFixtures);
      }) as TestAPIs['extend'];
      return api;
    };

    return extend(fixtures);
  }) as TestAPIs['extend'];

  const createDescribeAPI = (
    options: {
      sequential?: boolean;
      concurrent?: boolean;
      runMode?: 'skip' | 'only' | 'todo';
    } = {},
  ): DescribeAPI => {
    const describeFn = ((name, fn) =>
      runtimeInstance.describe({
        name,
        fn,
        ...options,
      })) as DescribeAPI;

    for (const { name, overrides } of [
      { name: 'only', overrides: { runMode: 'only' as const } },
      { name: 'todo', overrides: { runMode: 'todo' as const } },
      { name: 'skip', overrides: { runMode: 'skip' as const } },
      { name: 'concurrent', overrides: { concurrent: true } },
      { name: 'sequential', overrides: { sequential: true } },
    ]) {
      Object.defineProperty(describeFn, name, {
        get: () => {
          return createDescribeAPI({ ...options, ...overrides });
        },
        enumerable: true,
      });
    }

    describeFn.skipIf = (condition: boolean) =>
      condition ? describeFn.skip : describeFn;
    describeFn.runIf = (condition: boolean) =>
      condition ? describeFn : describeFn.skip;

    describeFn.each = ((cases: any) =>
      runtimeInstance.describeEach({
        cases,
        ...options,
      })) as DescribeEachFn;

    describeFn.for = ((cases: any) =>
      runtimeInstance.describeFor({
        cases,
        ...options,
      })) as DescribeForFn;

    return describeFn;
  };

  const describe = createDescribeAPI();

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
