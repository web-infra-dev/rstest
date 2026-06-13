import type { assert } from 'chai';
import type { ExpectStatic } from './expect';
import type { RstestUtilities } from './mock';
import type {
  AfterAllListener,
  AfterEachListener,
  BeforeAllListener,
  BeforeEachListener,
  TestResult,
} from './testSuite';
import type { MaybePromise } from './utils';

export interface TestContext {
  /**
   * Metadata of the current test
   */
  task: {
    /** A stable, unique identifier for the test */
    id: string;
    /** Test name provided by user */
    name: string;
    /** Absolute path of the current test file when provided by the runner */
    filepath?: string;
    /** Result of the current test, undefined if the test is not run yet */
    result?: TestResult;
  };
  expect: RstestExpect;
  /** Skip the current test during execution. */
  skip: () => never;
  onTestFinished: RunnerAPI['onTestFinished'];
  onTestFailed: RunnerAPI['onTestFailed'];
}

export type TestCallbackFn<ExtraContext = object> = (
  context: TestContext & ExtraContext,
) => MaybePromise<void>;

/**
 * Per-test options accepted as the third argument of `test` / `it` / `test.each` /
 * `test.for`. Passing a plain `number` is equivalent to `{ timeout: n }`.
 *
 * Declared as an `interface` so consumers can use module augmentation to add
 * fields in the future without breaking source compatibility.
 */
export interface TestOptions {
  /**
   * Per-test timeout in milliseconds. Overrides `test.testTimeout`.
   */
  timeout?: number;
  /**
   * Number of times to retry the test if it fails. Overrides `test.retry`.
   *
   * @default 0
   */
  retry?: number;
  /**
   * Number of times to re-run the test after it has already passed. The test is
   * considered failed as soon as any run fails. Total executions per case is
   * `repeats + 1`. Orthogonal to `retry`: each repeat independently honors the
   * configured retry budget.
   *
   * @default 0
   */
  repeats?: number;
}

type TestFn<ExtraContext = object> = (
  description: string,
  fn?: TestCallbackFn<ExtraContext>,
  options?: number | TestOptions,
) => void;

export interface TestEachFn {
  <T extends Record<string, unknown>>(
    cases: readonly T[],
  ): (
    description: string,
    fn?: (param: T) => MaybePromise<void>,
    options?: number | TestOptions,
  ) => void;
  <T extends readonly [unknown, ...unknown[]]>(
    cases: readonly T[],
  ): (
    description: string,
    fn: (...args: [...T]) => MaybePromise<void>,
    options?: number | TestOptions,
  ) => void;
  <T>(
    cases: readonly T[],
  ): (
    description: string,
    fn: (...args: T[]) => MaybePromise<void>,
    options?: number | TestOptions,
  ) => void;
  <T extends Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...expressions: unknown[]
  ): (
    description: string,
    fn?: (param: T) => MaybePromise<void>,
    options?: number | TestOptions,
  ) => void;
}

export interface TestForFn<ExtraContext = object> {
  <T>(
    cases: readonly T[],
  ): (
    description: string,
    fn?: (param: T, context: TestContext & ExtraContext) => MaybePromise<void>,
    options?: number | TestOptions,
  ) => void;
  <T extends Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...expressions: unknown[]
  ): (
    description: string,
    fn?: (param: T, context: TestContext & ExtraContext) => MaybePromise<void>,
    options?: number | TestOptions,
  ) => void;
}

export interface DescribeEachFn {
  <T extends Record<string, unknown>>(
    cases: readonly T[],
  ): (description: string, fn?: (param: T) => MaybePromise<void>) => void;
  <T extends readonly [unknown, ...unknown[]]>(
    cases: readonly T[],
  ): (description: string, fn: (...args: [...T]) => MaybePromise<void>) => void;
  <T>(
    cases: readonly T[],
  ): (description: string, fn: (param: T) => MaybePromise<void>) => void;
  <T extends Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...expressions: unknown[]
  ): (description: string, fn?: (param: T) => MaybePromise<void>) => void;
}

export interface DescribeForFn {
  <T>(
    cases: readonly T[],
  ): (description: string, fn?: (param: T) => MaybePromise<void>) => void;
  <T extends Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...expressions: unknown[]
  ): (description: string, fn?: (param: T) => MaybePromise<void>) => void;
}

export type TestAPI<ExtraContext = object> = TestFn<ExtraContext> & {
  each: TestEachFn;
  for: TestForFn<ExtraContext>;
  fails: TestAPI<ExtraContext>;
  concurrent: TestAPI<ExtraContext>;
  sequential: TestAPI<ExtraContext>;
  only: TestAPI<ExtraContext>;
  skip: TestAPI<ExtraContext>;
  todo: TestAPI<ExtraContext>;
  runIf: (condition: boolean) => TestAPI<ExtraContext>;
  skipIf: (condition: boolean) => TestAPI<ExtraContext>;
};

type DescribeFn = (description: string, fn?: () => void) => void;

export type DescribeAPI = DescribeFn & {
  each: DescribeEachFn;
  for: DescribeForFn;
  only: DescribeAPI;
  skip: DescribeAPI;
  runIf: (condition: boolean) => DescribeAPI;
  skipIf: (condition: boolean) => DescribeAPI;
  todo: DescribeAPI;
  concurrent: DescribeAPI;
  sequential: DescribeAPI;
};

interface FixtureOptions {
  /**
   * Whether to automatically set up current fixture, even though it's not being used in tests.
   */
  auto?: boolean;
}

type Use<T> = (value: T) => Promise<void>;

type FixtureFn<T, K extends keyof T, ExtraContext> = (
  context: Omit<T, K> & ExtraContext,
  use: Use<T[K]>,
) => Promise<void>;

type Fixture<T, K extends keyof T, ExtraContext = object> = ((
  ...args: any
) => any) extends T[K]
  ? T[K] extends any
    ? FixtureFn<T, K, Omit<ExtraContext, Exclude<keyof T, K>>>
    : never
  :
      | T[K]
      | (T[K] extends any
          ? FixtureFn<T, K, Omit<ExtraContext, Exclude<keyof T, K>>>
          : never);

export type Fixtures<
  T extends Record<string, any> = object,
  ExtraContext = object,
> = {
  [K in keyof T]:
    | Fixture<T, K, ExtraContext & TestContext>
    | [Fixture<T, K, ExtraContext & TestContext>, FixtureOptions?];
};

export type NormalizedFixture = {
  isFn: boolean;
  deps?: string[];
  value: FixtureFn<any, any, any> | any;
  options?: FixtureOptions;
};

export type NormalizedFixtures = Record<string, NormalizedFixture>;

export type TestAPIs<ExtraContext = object> = TestAPI<ExtraContext> & {
  extend: <T extends Record<string, any> = object>(
    fixtures: Fixtures<T, ExtraContext>,
  ) => TestAPIs<{
    [K in keyof T | keyof ExtraContext]: K extends keyof T
      ? T[K]
      : K extends keyof ExtraContext
        ? ExtraContext[K]
        : never;
  }>;
};

export type OnTestFinishedHandler = (ctx: TestContext) => MaybePromise<void>;

export type OnTestFailedHandler = (ctx: TestContext) => MaybePromise<void>;

export type RunnerAPI = {
  describe: DescribeAPI;
  it: TestAPIs;
  test: TestAPIs;
  beforeAll: (fn: BeforeAllListener, timeout?: number) => void;
  afterAll: (fn: AfterAllListener, timeout?: number) => void;
  beforeEach: (fn: BeforeEachListener, timeout?: number) => void;
  afterEach: (fn: AfterEachListener, timeout?: number) => void;
  onTestFinished: (fn: OnTestFinishedHandler, timeout?: number) => void;
  onTestFailed: (fn: OnTestFailedHandler, timeout?: number) => void;
};

export type RstestExpect = ExpectStatic;

export type Rstest = RunnerAPI & {
  expect: RstestExpect;
  assert: typeof assert;
  rstest: RstestUtilities;
  rs: RstestUtilities;
};
