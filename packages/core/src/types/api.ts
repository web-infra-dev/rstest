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

export interface DescribeEachFn {
  <T extends Record<string, unknown>>(
    cases: ReadonlyArray<T>,
  ): (description: string, fn?: (param: T) => MaybePromise<void>) => void;
  <T extends readonly [unknown, ...Array<unknown>]>(
    cases: ReadonlyArray<T>,
  ): (description: string, fn: (...args: [...T]) => MaybePromise<void>) => void;
}

export type TestBaseAPI = TestFn & {
  each: TestEachFn;
  fails: TestFn;
};

export type TestAPI = TestBaseAPI & {
  only: TestBaseAPI;
  skip: TestBaseAPI;
  todo: TestFn;
};

type DescribeFn = (description: string, fn?: () => void) => void;

export type DescribeBaseAPI = DescribeFn & {
  each: DescribeEachFn;
};

export type DescribeAPI = DescribeBaseAPI & {
  only: DescribeBaseAPI;
  skip: DescribeBaseAPI;
  todo: DescribeFn;
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
