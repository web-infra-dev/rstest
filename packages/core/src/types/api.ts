import type { ExpectStatic } from '@vitest/expect';
import type {
  AfterAllListener,
  AfterEachListener,
  BeforeAllListener,
  BeforeEachListener,
} from './testSuite';
import type { MaybePromise } from './utils';

type TestFn = (description: string, fn: () => MaybePromise<void>) => void;

export type TestAPI = TestFn & {
  fails: TestFn;
  todo: TestFn;
  skip: TestFn;
};

export type RunnerAPI = {
  describe: (description: string, fn: () => void) => void;
  it: TestAPI;
  test: TestAPI;
  // TODO: support timeout
  beforeAll: (fn: BeforeAllListener) => MaybePromise<void>;
  afterAll: (fn: AfterAllListener) => MaybePromise<void>;
  beforeEach: (fn: BeforeEachListener) => MaybePromise<void>;
  afterEach: (fn: AfterEachListener) => MaybePromise<void>;
};

export type RstestExpect = ExpectStatic;

export type Rstest = RunnerAPI & {
  expect: RstestExpect;
};
