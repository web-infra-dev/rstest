import type {
  Assertion,
  ExpectStatic,
  PromisifyAssertion,
  Tester,
} from '@vitest/expect';
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

interface ExpectPollOptions {
  /**
   * @default 50
   */
  interval?: number;
  /**
   * @default 1000
   */
  timeout?: number;
  message?: string;
}

export type RstestExpect = ExpectStatic & {
  unreachable: (message?: string) => never;
  soft: <T>(actual: T, message?: string) => Assertion<T>;
  poll: <T>(
    actual: () => T,
    options?: ExpectPollOptions,
  ) => Omit<
    PromisifyAssertion<Awaited<T>>,
    | 'rejects'
    | 'resolves'
    | 'toThrow'
    | 'toThrowError'
    | 'throw'
    | 'throws'
    | 'matchSnapshot'
    | 'toMatchSnapshot'
    | 'toMatchInlineSnapshot'
    | 'toThrowErrorMatchingSnapshot'
    | 'toThrowErrorMatchingInlineSnapshot'
  >;
  addEqualityTesters: (testers: Array<Tester>) => void;
  assertions: (expected: number) => void;
  hasAssertions: () => void;
  // addSnapshotSerializer: (plugin: PrettyFormatPlugin) => void
};

export type Rstest = RunnerAPI & {
  expect: RstestExpect;
};
