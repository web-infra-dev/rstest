import { normalize } from 'pathe';
import { parse as stackTraceParse } from 'stacktrace-parser';
import { fileURLToPath } from 'url-extras';
import type {
  AfterAllListener,
  AfterEachListener,
  BeforeAllListener,
  BeforeEachListener,
  DescribeAPI,
  DescribeEachFn,
  DescribeForFn,
  Fixtures,
  Location,
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
  TestOptions,
  TestRunMode,
  TestSuite,
} from '../../types';
import {
  ROOT_SUITE_NAME,
  SYNTHETIC_STACK_ERROR_MESSAGE,
} from '../../utils/constants';
import { castArray, generateFilePathHash } from '../../utils/helper';
import { fileContext } from '../fileContext';
import {
  formatName,
  isTemplateStringsArray,
  parseTemplateTable,
  resolveTestArgs,
  TestRegisterError,
} from '../util';
import { normalizeFixtures } from './fixtures';
import { registerTestSuiteListener, wrapTimeout } from './task';

type CollectStatus = 'lazy' | 'running';

/**
 * Run-mode / concurrency modifiers shared by the `test` and `describe` APIs.
 * Both factories install these as chainable getters (`test.skip`,
 * `describe.only`, …), so listing them once here keeps the two installs from
 * drifting — a new shared modifier is added in a single place. API-specific
 * modifiers (e.g. `test.fails`) stay inline at their call site.
 */
const SHARED_RUN_MODIFIERS = [
  { name: 'only', overrides: { runMode: 'only' } },
  { name: 'todo', overrides: { runMode: 'todo' } },
  { name: 'skip', overrides: { runMode: 'skip' } },
  { name: 'concurrent', overrides: { concurrent: true } },
  { name: 'sequential', overrides: { sequential: true } },
] as const;

export class RunnerRuntime {
  /** all test cases */
  private readonly tests: Test[] = [];
  /** a calling stack of the current test suites and case */
  private readonly _currentTest: Test[] = [];
  private readonly testPath: string;
  private status: 'running' | 'collect' = 'collect';

  /**
   * Collect test status:
   * - lazy: add fn to `currentCollectList` to delay collection;
   * - running: collect it immediately.
   */
  private collectStatus: CollectStatus = 'lazy';
  private currentCollectList: (() => MaybePromise<void>)[] = [];
  private readonly runtimeConfig;
  private readonly project: string;
  private readonly fileHash: string;

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
    this.fileHash = generateFilePathHash(project, testPath);
    this.runtimeConfig = runtimeConfig;
  }

  updateStatus(status: 'running' | 'collect'): void {
    this.status = status;
  }

  /**
   * Resolve the source location of the current registration call within this
   * file. Lives on the runner (not a per-file closure) so a late-bound test API
   * computes the location against the current file's `testPath`.
   */
  getLocation(): Location | undefined {
    if (!this.runtimeConfig.includeTaskLocation) return undefined;
    const stack = new Error().stack;
    if (stack) {
      const frames = stackTraceParse(stack);
      for (const frame of frames) {
        let filename = frame.file ?? '';
        if (filename.startsWith('file://')) filename = fileURLToPath(filename);
        // testPath is always unix path style, so convert filename with same way
        filename = normalize(filename);
        if (filename === this.testPath) {
          const line = frame.lineNumber;
          const column = frame.column;
          if (line != null && column != null) return { line, column };
        }
      }
    }
    return undefined;
  }

  private checkStatus(name: string, type: 'case' | 'suite'): void {
    if (this.status === 'running') {
      const error = new TestRegisterError(
        `${type === 'case' ? 'Test' : 'Describe'} '${name}' cannot run`,
      );

      throw error;
    }
  }

  /**
   * Register a suite hook listener. The explicit `void` return keeps the body
   * strictly checked — a contextual `void` would silently ignore an accidental
   * `Promise` return.
   */
  private registerHook(
    key: 'beforeAll' | 'afterAll' | 'beforeEach' | 'afterEach',
    fn:
      | AfterAllListener
      | BeforeAllListener
      | AfterEachListener
      | BeforeEachListener,
    timeout: number,
  ): void {
    registerTestSuiteListener(
      this.getCurrentSuite(),
      key,
      wrapTimeout({
        name: `${key} hook`,
        fn,
        timeout,
        stackTraceError: new Error(SYNTHETIC_STACK_ERROR_MESSAGE),
      }),
    );
  }

  // Hook registration signatures derive from the public `RunnerAPI` contract so
  // the implementation cannot drift from it. Arrow fields are used so the
  // signature can be borrowed from a type (methods cannot) and so `this` stays
  // bound without an explicit `.bind` at the call site.
  afterAll: RunnerAPI['afterAll'] = (
    fn,
    timeout = this.runtimeConfig.hookTimeout,
  ) => this.registerHook('afterAll', fn, timeout);

  beforeAll: RunnerAPI['beforeAll'] = (
    fn,
    timeout = this.runtimeConfig.hookTimeout,
  ) => this.registerHook('beforeAll', fn, timeout);

  afterEach: RunnerAPI['afterEach'] = (
    fn,
    timeout = this.runtimeConfig.hookTimeout,
  ) => this.registerHook('afterEach', fn, timeout);

  beforeEach: RunnerAPI['beforeEach'] = (
    fn,
    timeout = this.runtimeConfig.hookTimeout,
  ) => this.registerHook('beforeEach', fn, timeout);

  private getDefaultRootSuite(): Omit<TestSuite, 'testId'> {
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
    location,
  }: {
    name: string;
    fn?: () => MaybePromise<void>;
    runMode?: TestRunMode;
    each?: boolean;
    concurrent?: boolean;
    sequential?: boolean;
    location?: Location;
  }): void {
    this.checkStatus(name, 'suite');
    const currentSuite: Omit<TestSuite, 'testId'> = {
      project: this.project,
      name,
      runMode,
      tests: [],
      type: 'suite',
      each,
      testPath: this.testPath,
      concurrent,
      sequential,
      location,
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

  addTest(
    testInfo: Omit<TestSuite, 'testId'> | Omit<TestCase, 'testId'>,
  ): void {
    // Compute index-based testId: {fileHash}_{idx0}_{idx1}_...
    // The internal ROOT_SUITE_NAME uses the fileHash directly so it doesn't
    // add an extra level to child IDs.
    const parent =
      this._currentTest.length > 0
        ? this._currentTest[this._currentTest.length - 1]
        : undefined;

    let testId: string;
    if (testInfo.name === ROOT_SUITE_NAME) {
      testId = this.fileHash;
    } else {
      const childIndex =
        parent && parent.type === 'suite'
          ? parent.tests.length
          : this.tests.length;
      const parentId = parent?.testId ?? this.fileHash;
      testId = `${parentId}_${childIndex}`;
    }

    const test = {
      ...testInfo,
      testId,
    };
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

  addTestCase(test: Omit<TestCase, 'testPath' | 'context' | 'testId'>): void {
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
    retry,
    repeats,
    runMode = 'run',
    fails = false,
    each = false,
    concurrent,
    sequential,
    location,
  }: {
    name: string;
    fixtures?: NormalizedFixtures;
    originalFn?: TestCallbackFn;
    fn?: TestCallbackFn;
    timeout?: number;
    retry?: number;
    repeats?: number;
    runMode?: TestRunMode;
    each?: boolean;
    fails?: boolean;
    concurrent?: boolean;
    sequential?: boolean;
    location?: Location;
  }): void {
    this.checkStatus(name, 'case');
    this.addTestCase({
      project: this.project,
      name,
      originalFn,
      fn,
      stackTraceError: new Error(SYNTHETIC_STACK_ERROR_MESSAGE),
      runMode,
      type: 'case',
      timeout,
      retry,
      repeats,
      fixtures,
      concurrent,
      sequential,
      each,
      fails,
      onFinished: [],
      onFailed: [],
      location,
    });
  }

  describeEach({
    cases,
    ...options
  }: {
    cases: readonly unknown[];
    runMode?: TestRunMode;
    concurrent?: boolean;
    sequential?: boolean;
    location?: Location;
  }): (name: string, fn: (...args: any[]) => any) => void {
    return (name: string, fn) => {
      for (let i = 0; i < cases.length; i++) {
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
    cases: readonly unknown[];
    runMode?: TestRunMode;
    concurrent?: boolean;
    sequential?: boolean;
    location?: Location;
  }): (name: string, fn: (...args: any[]) => any) => void {
    return (name: string, fn) => {
      for (let i = 0; i < cases.length; i++) {
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
    cases: readonly unknown[];
    runMode?: TestRunMode;
    fails?: boolean;
    concurrent?: boolean;
    sequential?: boolean;
    location?: Location;
  }): (
    name: string,
    arg2?: ((...args: any[]) => any) | TestOptions,
    arg3?: ((...args: any[]) => any) | number,
  ) => void {
    return (name, arg2, arg3) => {
      const { fn, options: testOptions } = resolveTestArgs(arg2, arg3);
      const { timeout, retry, repeats } = testOptions;
      for (let i = 0; i < cases.length; i++) {
        const param = cases[i]!;
        const params = castArray(param) as any[];

        this.it({
          name: formatName(name, param, i),
          originalFn: fn,
          fn: () => fn?.(...params),
          timeout: timeout ?? this.runtimeConfig.testTimeout,
          retry,
          repeats,
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
    cases: readonly unknown[];
    fails?: boolean;
    runMode?: TestRunMode;
    concurrent?: boolean;
    sequential?: boolean;
    location?: Location;
  }): (
    name: string,
    arg2?: ((...args: any[]) => any) | TestOptions,
    arg3?: ((...args: any[]) => any) | number,
  ) => void {
    return (name, arg2, arg3) => {
      const { fn, options: testOptions } = resolveTestArgs(arg2, arg3);
      const { timeout, retry, repeats } = testOptions;
      for (let i = 0; i < cases.length; i++) {
        const param = cases[i]!;

        this.it({
          name: formatName(name, param, i),
          originalFn: fn,
          fn: (context) => fn?.(param, context),
          timeout: timeout ?? this.runtimeConfig.testTimeout,
          retry,
          repeats,
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

// The running file's collection-phase registrar (see the live-binding
// contract in `../api`; `createRunner` publishes the context per file).
const currentRuntime = (): RunnerRuntime => fileContext().runnerRuntime;

/**
 * The collection-phase subset of the runner API — everything except the
 * execution-phase `onTestFinished`/`onTestFailed`, which are added in
 * runner/index.ts to form the full `runnerAPI`.
 */
type CollectionAPI = Omit<RunnerAPI, 'onTestFinished' | 'onTestFailed'>;

// Build the collection-phase surface ONCE at module load (`runtimeAPI` below).
// Every leaf registration resolves `currentRuntime()` at call time and closes
// over nothing per-file (see the live-binding contract in `../api`).
const buildRuntimeAPI = (): CollectionAPI => {
  const createTestAPI = (
    options: {
      concurrent?: boolean;
      sequential?: boolean;
      fails?: boolean;
      fixtures?: NormalizedFixtures;
      runMode?: 'skip' | 'only' | 'todo';
      location?: Location;
    } = {},
  ): TestAPI => {
    const testFn = ((name, arg2, arg3) => {
      const { fn, options: testOptions } = resolveTestArgs(arg2, arg3);
      const { timeout, retry, repeats } = testOptions;
      const rt = currentRuntime();
      rt.it({
        name,
        fn,
        timeout,
        retry,
        repeats,
        ...options,
        location: options.location ?? rt.getLocation(),
      });
    }) as TestAPI;

    for (const { name, overrides } of [
      { name: 'fails', overrides: { fails: true } },
      ...SHARED_RUN_MODIFIERS,
    ]) {
      Object.defineProperty(testFn, name, {
        get: () => {
          return createTestAPI({ ...options, ...overrides });
        },
        enumerable: true,
      });
    }

    testFn.runIf = (condition: boolean) =>
      createTestAPI({
        ...options,
        location: currentRuntime().getLocation(),
        runMode: condition ? options.runMode : 'skip',
      });

    testFn.skipIf = (condition: boolean) =>
      createTestAPI({
        ...options,
        location: currentRuntime().getLocation(),
        runMode: condition ? 'skip' : options.runMode,
      });

    testFn.each = ((...args: any[]) => {
      const rt = currentRuntime();
      const location = rt.getLocation();
      const cases = isTemplateStringsArray(args[0])
        ? parseTemplateTable(args[0], ...args.slice(1))
        : args[0];
      return rt.each({ cases, ...options, location });
    }) as TestEachFn;

    testFn.for = ((...args: any[]) => {
      const rt = currentRuntime();
      const location = rt.getLocation();
      const cases = isTemplateStringsArray(args[0])
        ? parseTemplateTable(args[0], ...args.slice(1))
        : args[0];
      return rt.for({ cases, ...options, location });
    }) as TestForFn;

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
      location?: Location;
    } = {},
  ): DescribeAPI => {
    const describeFn = ((name, fn) => {
      const rt = currentRuntime();
      rt.describe({
        name,
        fn,
        ...options,
        location: options.location ?? rt.getLocation(),
      });
    }) as DescribeAPI;

    for (const { name, overrides } of SHARED_RUN_MODIFIERS) {
      Object.defineProperty(describeFn, name, {
        get: () => {
          return createDescribeAPI({ ...options, ...overrides });
        },
        enumerable: true,
      });
    }

    describeFn.skipIf = (condition: boolean) =>
      createDescribeAPI({
        ...options,
        location: currentRuntime().getLocation(),
        runMode: condition ? 'skip' : options.runMode,
      });
    describeFn.runIf = (condition: boolean) =>
      createDescribeAPI({
        ...options,
        location: currentRuntime().getLocation(),
        runMode: condition ? options.runMode : 'skip',
      });

    describeFn.each = ((...args: any[]) => {
      const rt = currentRuntime();
      const location = rt.getLocation();
      const cases = isTemplateStringsArray(args[0])
        ? parseTemplateTable(args[0], ...args.slice(1))
        : args[0];
      return rt.describeEach({ cases, ...options, location });
    }) as DescribeEachFn;

    describeFn.for = ((...args: any[]) => {
      const rt = currentRuntime();
      const location = rt.getLocation();
      const cases = isTemplateStringsArray(args[0])
        ? parseTemplateTable(args[0], ...args.slice(1))
        : args[0];
      return rt.describeFor({ cases, ...options, location });
    }) as DescribeForFn;

    return describeFn;
  };

  const describe = createDescribeAPI();

  return {
    describe,
    it,
    test: it,
    afterAll: (...args) => currentRuntime().afterAll(...args),
    beforeAll: (...args) => currentRuntime().beforeAll(...args),
    afterEach: (...args) => currentRuntime().afterEach(...args),
    beforeEach: (...args) => currentRuntime().beforeEach(...args),
  };
};

/** The stable collection-phase surface. Built once; see `buildRuntimeAPI`. */
export const runtimeAPI: CollectionAPI = buildRuntimeAPI();
