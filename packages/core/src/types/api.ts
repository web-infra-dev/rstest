import type { Assertion, ExpectStatic, Tester } from '@vitest/expect';

type TestFn = (description: string, fn: () => void | Promise<void>) => void;

export type TestAPI = TestFn & {
  fails: TestFn;
  todo: TestFn;
  skip: TestFn;
};

export type RunnerAPI = {
  describe: (description: string, fn: () => void) => void;
  it: TestAPI;
  test: TestAPI;
};

export type RstestExpect = ExpectStatic & {
  unreachable: (message?: string) => never;
  soft: <T>(actual: T, message?: string) => Assertion<T>;
  // poll: <T>(
  //   actual: () => T,
  //   options?: ExpectPollOptions
  // ) => PromisifyAssertion<Awaited<T>>
  addEqualityTesters: (testers: Array<Tester>) => void;
  assertions: (expected: number) => void;
  hasAssertions: () => void;
  // addSnapshotSerializer: (plugin: PrettyFormatPlugin) => void
};

export type Rstest = RunnerAPI & {
  expect: RstestExpect;
};
