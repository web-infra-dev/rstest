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

export type TestContext = {
  /**
   * Metadata of the current test
   */
  task: {
    /** A stable, unique identifier for the test */
    id: string;
    /** Test name provided by user */
    name: string;
    /** Result of the current test, undefined if the test is not run yet */
    result?: TestResult;
  };
  expect: RstestExpect;
  onTestFinished: RunnerAPI['onTestFinished'];
  onTestFailed: RunnerAPI['onTestFailed'];
};

export type TestCallbackFn<ExtraContext = object> = (
  context: TestContext & ExtraContext,
) => MaybePromise<void>;

type TestFn<ExtraContext = object> = (
  description: string,
  fn?: TestCallbackFn<ExtraContext>,
  timeout?: number,
) => void;

export interface TestEachFn {
  <T extends Record<string, unknown>>(
    cases: readonly T[],
  ): (
    description: string,
    fn?: (param: T) => MaybePromise<void>,
    timeout?: number,
  ) => void;
  <T extends readonly [unknown, ...unknown[]]>(
    cases: readonly T[],
  ): (
    description: string,
    fn: (...args: [...T]) => MaybePromise<void>,
    timeout?: number,
  ) => void;
  <T>(
    cases: readonly T[],
  ): (
    description: string,
    fn: (...args: T[]) => MaybePromise<void>,
    timeout?: number,
  ) => void;
  <T extends Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...expressions: unknown[]
  ): (
    description: string,
    fn?: (param: T) => MaybePromise<void>,
    timeout?: number,
  ) => void;
}

export interface TestForFn<ExtraContext = object> {
  <T>(
    cases: readonly T[],
  ): (
    description: string,
    fn?: (param: T, context: TestContext & ExtraContext) => MaybePromise<void>,
    timeout?: number,
  ) => void;
  <T extends Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...expressions: unknown[]
  ): (
    description: string,
    fn?: (param: T, context: TestContext & ExtraContext) => MaybePromise<void>,
    timeout?: number,
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

export type FixtureScope = 'test' | 'file';

export interface FixtureOptions {
  /**
   * Whether to automatically set up current fixture, even though it's not being used in tests.
   */
  auto?: boolean;
  /**
   * Lifetime of the fixture instance.
   * - `test` (default): set up before each test, torn down after.
   * - `file`: set up once on first use within a test file, torn down after the file's tests finish.
   */
  scope?: FixtureScope;
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

/**
 * Helpers passed as the second argument to a builder-style fixture
 * (i.e. `extend(name, opts?, fn)`).
 */
export interface ScopedFixtureHelpers {
  /**
   * Register a cleanup handler that runs when the fixture is torn down.
   * - test scope: runs after the current test finishes.
   * - file scope: runs after all tests in the file finish.
   * Multiple `onCleanup` calls are allowed; they run in LIFO order.
   */
  onCleanup: (handler: () => void | Promise<void>) => void;
}

/**
 * Builder-style fixture body: returns the fixture value and registers
 * cleanup via the `onCleanup` helper.
 */
export type ScopedFixtureFn<V, ExtraContext = object> = (
  context: ExtraContext & TestContext,
  helpers: ScopedFixtureHelpers,
) => V | Promise<V>;

export type NormalizedFixtureStyle = 'use-callback' | 'return';

export type NormalizedFixture = {
  isFn: boolean;
  deps?: string[];
  value: FixtureFn<any, any, any> | any;
  options?: FixtureOptions;
  scope: FixtureScope;
  style: NormalizedFixtureStyle;
};

export type NormalizedFixtures = Record<string, NormalizedFixture>;

export interface TestExtendAPI<ExtraContext = object> {
  /** Register fixtures using the object syntax. */
  <T extends Record<string, any> = object>(
    fixtures: Fixtures<T, ExtraContext>,
  ): TestAPIs<{
    [K in keyof T | keyof ExtraContext]: K extends keyof T
      ? T[K]
      : K extends keyof ExtraContext
        ? ExtraContext[K]
        : never;
  }>;
  /** Register a single fixture using the builder syntax. */
  <Name extends string, V>(
    name: Name,
    fn: ScopedFixtureFn<V, ExtraContext>,
  ): TestAPIs<ExtraContext & { [K in Name]: V }>;
  /** Register a single scoped fixture using the builder syntax. */
  <Name extends string, V>(
    name: Name,
    options: FixtureOptions,
    fn: ScopedFixtureFn<V, ExtraContext>,
  ): TestAPIs<ExtraContext & { [K in Name]: V }>;
}

export type TestAPIs<ExtraContext = object> = TestAPI<ExtraContext> & {
  extend: TestExtendAPI<ExtraContext>;
};

export type OnTestFinishedHandler = (ctx: TestContext) => MaybePromise<void>;

export type OnTestFailedHandler = (ctx: TestContext) => MaybePromise<void>;

export type RunnerAPI = {
  describe: DescribeAPI;
  it: TestAPIs;
  test: TestAPIs;
  beforeAll: (fn: BeforeAllListener, timeout?: number) => MaybePromise<void>;
  afterAll: (fn: AfterAllListener, timeout?: number) => MaybePromise<void>;
  beforeEach: (fn: BeforeEachListener, timeout?: number) => MaybePromise<void>;
  afterEach: (fn: AfterEachListener, timeout?: number) => MaybePromise<void>;
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
