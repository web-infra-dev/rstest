import type { ExpectStatic } from '@vitest/expect';
import type { RstestUtilities } from './mock';
import type {
  AfterAllListener,
  AfterEachListener,
  BeforeAllListener,
  BeforeEachListener,
} from './testSuite';
import type { MaybePromise } from './utils';

type TestFn = (
  description: string,
  fn?: () => MaybePromise<void>,
  timeout?: number,
) => void;

export type TestEachFn<T> = (
  description: string,
  fn?: (param: T) => MaybePromise<void>,
  timeout?: number,
) => void;

export type TestAPI = TestFn & {
  fails: TestFn;
  only: TestFn;
  todo: TestFn;
  skip: TestFn;
  each: <T>(cases: T[]) => TestEachFn<T>;
};

type DescribeFn = (description: string, fn?: () => void) => void;
export type DescribeEachFn<T> = (
  description: string,
  fn?: (param: T) => void,
) => void;

export type DescribeAPI = DescribeFn & {
  only: DescribeFn;
  todo: DescribeFn;
  skip: DescribeFn;
  each: <T>(cases: T[]) => DescribeEachFn<T>;
};

export type RunnerAPI = {
  describe: DescribeAPI;
  it: TestAPI;
  test: TestAPI;
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
