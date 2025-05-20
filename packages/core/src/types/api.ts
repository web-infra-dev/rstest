import type { ExpectStatic } from '@vitest/expect';
import type { RstestUtilities } from './mock';
import type {
  AfterAllListener,
  AfterEachListener,
  BeforeAllListener,
  BeforeEachListener,
} from './testSuite';
import type { MaybePromise } from './utils';

export type TestContext = {
  expect: RstestExpect;
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
    cases: ReadonlyArray<T>,
  ): (
    description: string,
    fn?: (param: T) => MaybePromise<void>,
    timeout?: number,
  ) => void;
  <T extends readonly [unknown, ...Array<unknown>]>(
    cases: ReadonlyArray<T>,
  ): (
    description: string,
    fn: (...args: [...T]) => MaybePromise<void>,
    timeout?: number,
  ) => void;
}

export type TestForFn<ExtraContext = object> = <T>(
  cases: ReadonlyArray<T>,
) => (
  description: string,
  fn?: (param: T, context: TestContext & ExtraContext) => MaybePromise<void>,
  timeout?: number,
) => void;

export interface DescribeEachFn {
  <T extends Record<string, unknown>>(
    cases: ReadonlyArray<T>,
  ): (description: string, fn?: (param: T) => MaybePromise<void>) => void;
  <T extends readonly [unknown, ...Array<unknown>]>(
    cases: ReadonlyArray<T>,
  ): (description: string, fn: (...args: [...T]) => MaybePromise<void>) => void;
}

export type DescribeForFn = <T>(
  cases: ReadonlyArray<T>,
) => (description: string, fn?: (param: T) => MaybePromise<void>) => void;

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

// TODO: support fixture options
// interface FixtureOptions {
//   /**
//    * Whether to automatically set up current fixture, even though it's not being used in tests.
//    */
//   auto?: boolean;
//   /**
//    * Indicated if the injected value from the config should be preferred over the fixture value
//    */
//   injected?: boolean;
// }

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
  [K in keyof T]: Fixture<T, K, ExtraContext & TestContext>;
  // | [Fixture<T, K, ExtraContext & TestContext>, FixtureOptions?];
};

export type TestExtend = <
  T extends Record<string, any> = object,
  ExtraContext = object,
>(
  fixtures: Fixtures<T, ExtraContext>,
) => TestAPI<{
  [K in keyof T | keyof ExtraContext]: K extends keyof T
    ? T[K]
    : K extends keyof ExtraContext
      ? ExtraContext[K]
      : never;
}>;

export type RunnerAPI = {
  describe: DescribeAPI;
  it: TestAPI & {
    extend: TestExtend;
  };
  test: TestAPI & {
    extend: TestExtend;
  };
  beforeAll: (fn: BeforeAllListener, timeout?: number) => MaybePromise<void>;
  afterAll: (fn: AfterAllListener, timeout?: number) => MaybePromise<void>;
  beforeEach: (fn: BeforeEachListener, timeout?: number) => MaybePromise<void>;
  afterEach: (fn: AfterEachListener, timeout?: number) => MaybePromise<void>;
};

export type RstestExpect = ExpectStatic;

export type Rstest = RunnerAPI & {
  expect: RstestExpect;
  rstest: RstestUtilities;
};
