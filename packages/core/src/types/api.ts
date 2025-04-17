import type { ExpectStatic } from '@vitest/expect';
import type {
  AfterAllListener,
  AfterEachListener,
  BeforeAllListener,
  BeforeEachListener,
} from './testSuite';
import type { MaybePromise } from './utils';

type TestFn = (description: string, fn?: () => MaybePromise<void>) => void;

export type TestAPI = TestFn & {
  fails: TestFn;
  todo: TestFn;
  skip: TestFn;
};

type DescribeFn = (description: string, fn?: () => void) => void;

export type DescribeAPI = DescribeFn & {
  todo: DescribeFn;
  skip: DescribeFn;
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
};
