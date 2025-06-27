/**
 * This method is modified based on source found in
 * https://github.com/vitest-dev/vitest/blob/9a1b50122359123ad7f5999b85ee2f314d91e83d/packages/vitest/src/types/global.ts
 */
import type {
  Tester,
  Assertion as VitestAssertion,
  ExpectStatic as VitestExpectStatic,
  MatcherState as VitestMatcherState,
} from '@vitest/expect';
import type { addSerializer, SnapshotState } from '@vitest/snapshot';

interface SnapshotMatcher<T> {
  <U extends { [P in keyof T]: any }>(
    snapshot: Partial<U>,
    message?: string,
  ): void;
  (message?: string): void;
}

interface InlineSnapshotMatcher<T> {
  <U extends { [P in keyof T]: any }>(
    properties: Partial<U>,
    snapshot?: string,
    message?: string,
  ): void;
  (message?: string): void;
}

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

type Promisify<O> = {
  [K in keyof O]: O[K] extends (...args: infer A) => infer R
    ? Promisify<O[K]> & ((...args: A) => Promise<R>)
    : O[K];
};

type PromisifyAssertion<T> = Promisify<Assertion<T>>;

export interface Assertion<T = any> extends VitestAssertion<T> {
  // Snapshots are extended in @vitest/snapshot and are not part of @vitest/expect
  matchSnapshot: SnapshotMatcher<T>;
  toMatchSnapshot: SnapshotMatcher<T>;
  toMatchInlineSnapshot: InlineSnapshotMatcher<T>;

  /**
   * Checks that an error thrown by a function matches a previously recorded snapshot.
   *
   * @param message - Optional custom error message.
   *
   * @example
   * expect(functionWithError).toThrowErrorMatchingSnapshot();
   */
  toThrowErrorMatchingSnapshot: (message?: string) => void;

  /**
   * Checks that an error thrown by a function matches an inline snapshot within the test file.
   * Useful for keeping snapshots close to the test code.
   *
   * @param snapshot - Optional inline snapshot string to match.
   * @param message - Optional custom error message.
   *
   * @example
   * const throwError = () => { throw new Error('Error occurred') };
   * expect(throwError).toThrowErrorMatchingInlineSnapshot(`"Error occurred"`);
   */
  toThrowErrorMatchingInlineSnapshot: (
    snapshot?: string,
    message?: string,
  ) => void;

  /**
   * Compares the received value to a snapshot saved in a specified file.
   * Useful for cases where snapshot content is large or needs to be shared across tests.
   *
   * @param filepath - Path to the snapshot file.
   * @param message - Optional custom error message.
   *
   * @example
   * await expect(largeData).toMatchFileSnapshot('path/to/snapshot.json');
   */
  toMatchFileSnapshot: (filepath: string, message?: string) => Promise<void>;

  /**
   * Verifies that a promise resolves.
   *
   * @example
   * await expect(someAsyncFunc).resolves.toBe(42);
   */
  resolves: PromisifyAssertion<T>;
  /**
   * Verifies that a promise rejects.
   *
   * @example
   * await expect(someAsyncFunc).rejects.toThrow('error');
   */
  rejects: PromisifyAssertion<T>;
}

export interface ExpectStatic extends VitestExpectStatic {
  <T>(actual: T, message?: string): Assertion<T>;
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
  addSnapshotSerializer: typeof addSerializer;

  getState: () => MatcherState;
  setState: (state: Partial<MatcherState>) => void;
}

export interface MatcherState extends VitestMatcherState {
  environment: string;
  snapshotState: SnapshotState;
}
