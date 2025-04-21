import type { MaybePromise } from 'src/types/utils';
import type {
  AfterAllListener,
  AfterEachListener,
  BeforeAllListener,
  BeforeEachListener,
  Test,
  TestCase,
  TestRunMode,
  TestSuite,
  TestSuiteListeners,
} from '../../types';
import { ROOT_SUITE_NAME } from '../../utils';

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

function makeError(message: string, stackTraceError?: Error) {
  const error = new Error(message);
  if (stackTraceError?.stack) {
    error.stack = stackTraceError.stack.replace(
      error.message,
      stackTraceError.message,
    );
  }
  return error;
}

function wrapTimeout<T extends (...args: any[]) => any>({
  name,
  fn,
  timeout,
  stackTraceError,
}: {
  name: string;
  fn: T;
  timeout: number;
  stackTraceError?: Error;
}): T {
  if (!timeout) {
    return fn;
  }

  return (async (...args: Parameters<T>) => {
    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(
        () =>
          reject(
            makeError(
              `${name} hook timed out in ${timeout}ms`,
              stackTraceError,
            ),
          ),
        timeout,
      );
    });

    try {
      const result = await Promise.race([fn(...args), timeoutPromise]);
      timeoutId && clearTimeout(timeoutId);
      return result;
    } catch (error) {
      timeoutId && clearTimeout(timeoutId);
      throw error;
    }
  }) as T;
}

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
        name: 'afterAll',
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
        name: 'beforeAll',
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
        name: 'afterEach',
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
        name: 'beforeEach',
        fn,
        timeout,
        stackTraceError: new Error('STACK_TRACE_ERROR'),
      }),
    );
  }

  getDefaultRootSuite(): TestSuite {
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
  ): void {
    const currentSuite: TestSuite = {
      name,
      runMode,
      tests: [],
      type: 'suite',
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

  it(
    name: string,
    fn?: () => void | Promise<void>,
    timeout: number = this.defaultTestTimeout,
    runMode: TestRunMode = 'run',
  ): void {
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
    });
  }

  fails(
    name: string,
    fn?: () => void | Promise<void>,
    timeout: number = this.defaultTestTimeout,
  ): void {
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
      fails: true,
      runMode: 'run',
      type: 'case',
    });
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
}
