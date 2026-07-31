import type { assert } from 'chai';
import type { ExpectStatic } from './expect';
import type { RstestUtilities } from './mock';
import type {
  AfterAllListener,
  AfterEachListener,
  BeforeAllListener,
  BeforeEachListener,
  TaskMeta,
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
    /** Absolute path of the current project's root directory. */
    projectRoot?: string;
    /** Current retry index, starting at 0 for the initial attempt. */
    retryCount: number;
    /** Result of the current test, undefined if the test is not run yet */
    result?: TestResult;
    /** Mutable metadata copied to the current test result. */
    meta: TaskMeta;
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
 * Per-test options accepted as the second argument of `test` / `it` / `test.each` /
 * `test.for`. Passing a plain `number` as the last argument is equivalent to
 * `{ timeout: n }`.
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
  /**
   * Initial metadata for this test or suite. Suite metadata is inherited by
   * descendant suites and tests; child metadata overrides inherited keys.
   */
  meta?: TaskMeta;
}

/**
 * The two accepted call shapes shared by `test` / `it` and the functions returned
 * by `test.each` / `test.for`:
 * - `(name, fn, timeout?)` — test function second, with an optional numeric timeout
 *   last (kept for Jest compatibility; shorthand for `{ timeout: n }`).
 * - `(name, options, fn?)` — `TestOptions` object as the second argument.
 *
 * The function-first overload is listed first so the common `test(name, fn)` case
 * binds the callback's context types — a function value is otherwise assignable to
 * the all-optional `TestOptions`, which would swallow contextual typing.
 */
type TestCall<Fn> = {
  (description: string, fn?: Fn, timeout?: number): void;
  (description: string, options: TestOptions, fn?: Fn): void;
};

type TestFn<ExtraContext = object> = TestCall<TestCallbackFn<ExtraContext>>;

export interface TestEachFn {
  <T extends Record<string, unknown>>(
    cases: readonly T[],
  ): TestCall<(param: T) => MaybePromise<void>>;
  <T extends readonly [unknown, ...unknown[]]>(
    cases: readonly T[],
  ): TestCall<(...args: [...T]) => MaybePromise<void>>;
  <T>(cases: readonly T[]): TestCall<(...args: T[]) => MaybePromise<void>>;
  <T extends Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...expressions: unknown[]
  ): TestCall<(param: T) => MaybePromise<void>>;
}

export interface TestForFn<ExtraContext = object> {
  <T>(
    cases: readonly T[],
  ): TestCall<
    (param: T, context: TestContext & ExtraContext) => MaybePromise<void>
  >;
  <T extends Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...expressions: unknown[]
  ): TestCall<
    (param: T, context: TestContext & ExtraContext) => MaybePromise<void>
  >;
}

/**
 * The two accepted call shapes for `describe` and the functions returned by
 * `describe.each` / `describe.for`, mirroring `TestCall`:
 * - `(name, fn, timeout?)` — suite function second, optional numeric timeout last.
 * - `(name, options, fn?)` — `TestOptions` object as the second argument.
 *
 * Suite-level options propagate to descendant cases as inheritable defaults.
 */
type DescribeCall<Fn> = {
  (description: string, fn?: Fn, timeout?: number): void;
  (description: string, options: TestOptions, fn?: Fn): void;
};

export interface DescribeEachFn {
  <T extends Record<string, unknown>>(
    cases: readonly T[],
  ): DescribeCall<(param: T) => MaybePromise<void>>;
  <T extends readonly [unknown, ...unknown[]]>(
    cases: readonly T[],
  ): DescribeCall<(...args: [...T]) => MaybePromise<void>>;
  <T>(cases: readonly T[]): DescribeCall<(param: T) => MaybePromise<void>>;
  <T extends Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...expressions: unknown[]
  ): DescribeCall<(param: T) => MaybePromise<void>>;
}

export interface DescribeForFn {
  <T>(cases: readonly T[]): DescribeCall<(param: T) => MaybePromise<void>>;
  <T extends Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...expressions: unknown[]
  ): DescribeCall<(param: T) => MaybePromise<void>>;
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

type DescribeFn = DescribeCall<() => MaybePromise<void>>;

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

export type FixtureScope = 'test' | 'file' | 'worker';

export interface FixtureOptions {
  /**
   * Whether to automatically set up current fixture, even though it's not being used in tests.
   */
  auto?: boolean;
  /**
   * Lifecycle of the fixture.
   *
   * @default 'test'
   */
  scope?: FixtureScope;
}

export type Use<T> = (value: T) => Promise<void>;

export type FixtureCleanup = () => MaybePromise<void>;

export type FixtureLifecycle = {
  /**
   * Register one cleanup callback for a fixture created with the builder API.
   */
  onCleanup: (cleanup: FixtureCleanup) => void;
};

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
  : | T[K]
    | (T[K] extends any
        ? FixtureFn<T, K, Omit<ExtraContext, Exclude<keyof T, K>>>
        : never);

type TestFixtureOptions = Omit<FixtureOptions, 'scope'>;

export type Fixtures<
  T extends Record<string, any> = object,
  ExtraContext = object,
> = {
  [K in keyof T]:
    | Fixture<T, K, ExtraContext & TestContext>
    | [Fixture<T, K, ExtraContext & TestContext>, TestFixtureOptions?];
};

export type NormalizedFixture = {
  isFn: boolean;
  deps?: string[];
  dependencyFixtures: NormalizedFixture[];
  value: FixtureFn<any, any, any> | any;
  options: Required<FixtureOptions>;
  mode: 'use' | 'return';
};

export type NormalizedFixtures = Record<string, NormalizedFixture>;

type MergeFixtureContext<Context, Added extends Record<string, any>> = {
  [K in keyof Context | keyof Added]: K extends keyof Added
    ? Added[K]
    : K extends keyof Context
      ? Context[K]
      : never;
};

type BuilderFixture<Value, Context> =
  | Value
  | ((context: Context, lifecycle: FixtureLifecycle) => MaybePromise<Value>);

type FixtureNameWithoutOverrides<
  Name extends string,
  Existing,
> = Name extends keyof Existing ? never : Name;

type FixtureObjectWithoutOverrides<Added, Existing> = {
  [Name in Extract<keyof Added, keyof Existing>]: never;
};

type TestExtend<TestFixtures, FileFixtures, WorkerFixtures> = {
  <T extends Record<string, any> = object>(
    fixtures: Fixtures<T, TestFixtures & FileFixtures & WorkerFixtures> &
      FixtureObjectWithoutOverrides<T, FileFixtures & WorkerFixtures>,
  ): TestAPIs<
    MergeFixtureContext<TestFixtures, T>,
    FileFixtures,
    WorkerFixtures
  >;
  <Name extends string, Value>(
    name: FixtureNameWithoutOverrides<Name, FileFixtures & WorkerFixtures>,
    fixture: BuilderFixture<
      Value,
      Omit<TestContext & TestFixtures & FileFixtures & WorkerFixtures, Name>
    >,
  ): TestAPIs<
    MergeFixtureContext<TestFixtures, Record<Name, Value>>,
    FileFixtures,
    WorkerFixtures
  >;
  <Name extends string, Value>(
    name: FixtureNameWithoutOverrides<Name, FileFixtures & WorkerFixtures>,
    options: FixtureOptions & { scope?: 'test' },
    fixture: BuilderFixture<
      Value,
      Omit<TestContext & TestFixtures & FileFixtures & WorkerFixtures, Name>
    >,
  ): TestAPIs<
    MergeFixtureContext<TestFixtures, Record<Name, Value>>,
    FileFixtures,
    WorkerFixtures
  >;
  <Name extends string, Value>(
    name: FixtureNameWithoutOverrides<Name, TestFixtures & WorkerFixtures>,
    options: FixtureOptions & { scope: 'file' },
    fixture: BuilderFixture<Value, Omit<FileFixtures & WorkerFixtures, Name>>,
  ): TestAPIs<
    TestFixtures,
    MergeFixtureContext<FileFixtures, Record<Name, Value>>,
    WorkerFixtures
  >;
  <Name extends string, Value>(
    name: FixtureNameWithoutOverrides<Name, TestFixtures & FileFixtures>,
    options: FixtureOptions & { scope: 'worker' },
    fixture: BuilderFixture<Value, Omit<WorkerFixtures, Name>>,
  ): TestAPIs<
    TestFixtures,
    FileFixtures,
    MergeFixtureContext<WorkerFixtures, Record<Name, Value>>
  >;
};

export type TestAPIs<
  TestFixtures = object,
  FileFixtures = object,
  WorkerFixtures = object,
> = TestAPI<TestFixtures & FileFixtures & WorkerFixtures> & {
  extend: TestExtend<TestFixtures, FileFixtures, WorkerFixtures>;
};

export type OnTestFinishedHandler = (ctx: TestContext) => MaybePromise<void>;

export type OnTestFailedHandler = (ctx: TestContext) => MaybePromise<void>;

export type RunnerAPI = {
  describe: DescribeAPI;
  it: TestAPIs;
  test: TestAPIs;
  beforeAll: (fn: BeforeAllListener, timeout?: number) => void;
  afterAll: (fn: AfterAllListener, timeout?: number) => void;
  beforeEach: <ExtraContext = object>(
    fn: BeforeEachListener<ExtraContext>,
    timeout?: number,
  ) => void;
  afterEach: <ExtraContext = object>(
    fn: AfterEachListener<ExtraContext>,
    timeout?: number,
  ) => void;
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
