import type { ExpectStatic } from '@vitest/expect';
import type { AfterAllListener } from './testSuite';
import type { MaybePromise } from './utils';

type TestFn = (description: string, fn: () => void | Promise<void>) => void;

export type TestAPI = TestFn & {
  fails: TestFn;
  todo: TestFn;
  skip: TestFn;
};

type AfterAllAPI = (fn: AfterAllListener) => MaybePromise<void>;

export type RunnerAPI = {
  describe: (description: string, fn: () => void) => void;
  it: TestAPI;
  test: TestAPI;
  afterAll: AfterAllAPI;
};

export type RstestExpect = ExpectStatic;

export type Rstest = RunnerAPI & {
  expect: RstestExpect;
};
