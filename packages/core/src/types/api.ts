import type { ExpectStatic } from '@vitest/expect';
import type { AfterAllListener, BeforeAllListener } from './testSuite';
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
};

export type RstestExpect = ExpectStatic;

export type Rstest = RunnerAPI & {
  expect: RstestExpect;
};
