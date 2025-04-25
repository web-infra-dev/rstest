import type { FunctionLike } from './utils';

interface MockResultReturn<T> {
  type: 'return';
  /**
   * The value that was returned from the function. If function returned a Promise, then this will be a resolved value.
   */
  value: T;
}
interface MockResultIncomplete {
  type: 'incomplete';
  value: undefined;
}
interface MockResultThrow {
  type: 'throw';
  /**
   * An error that was thrown during function execution.
   */
  value: any;
}

type MockResult<T> =
  | MockResultReturn<T>
  | MockResultThrow
  | MockResultIncomplete;

interface MockSettledResultFulfilled<T> {
  type: 'fulfilled';
  value: T;
}
interface MockSettledResultRejected {
  type: 'rejected';
  value: any;
}

interface MockSettledResultFulfilled<T> {
  type: 'fulfilled';
  value: T;
}
interface MockSettledResultRejected {
  type: 'rejected';
  value: any;
}

type MockSettledResult<T> =
  | MockSettledResultFulfilled<T>
  | MockSettledResultRejected;

export type MockContext<T extends FunctionLike = FunctionLike> = {
  /**
   * List of the call arguments of all calls that have been made to the mock.
   */
  calls: Array<Parameters<T>>;
  /**
   * List of all the object instances that have been instantiated from the mock.
   */
  instances: Array<ReturnType<T>>;
  /**
   * List of all the function contexts that have been applied to calls to the mock.
   */
  contexts: Array<ThisParameterType<T>>;
  /**
   * The order of mock's execution.
   * This returns an array of numbers which are shared between all defined mocks.
   * The index is starting with `1`.
   */
  invocationCallOrder: Array<number>;
  /**
   * List of the call arguments of the last call that was made to the mock.
   * If the function was not called, it will return `undefined`.
   */
  lastCall: Parameters<T> | undefined;
  /**
   * List of the results of all calls that have been made to the mock.
   */
  results: Array<MockResult<ReturnType<T>>>;

  /**
   * List of the results of all values that were `resolved` or `rejected` from the function.
   */
  settledResults: MockSettledResult<Awaited<ReturnType<T>>>[];
};

export interface MockInstance<T extends FunctionLike = FunctionLike> {
  _isMockFunction: true;
  getMockName(): string;
  mockName(name: string): this;
  mock: MockContext<T>;
  mockClear(): this;
  mockReset(): this;
  mockRestore(): void;
  getMockImplementation(): T | undefined;
  mockImplementation(fn: T): this;
  mockImplementationOnce(fn: T): this;
  withImplementation<T2>(
    fn: T,
    callback: () => T2,
  ): T2 extends Promise<unknown> ? Promise<void> : void;
  mockReturnThis(): this;
  mockReturnValue(value: ReturnType<T>): this;
  mockReturnValueOnce(value: ReturnType<T>): this;
  mockResolvedValue(value: Awaited<ReturnType<T>>): this;
  mockResolvedValueOnce(value: Awaited<ReturnType<T>>): this;
  mockRejectedValue(error: unknown): this;
  mockRejectedValueOnce(error: unknown): this;
}

export interface Mock<T extends FunctionLike = FunctionLike>
  extends MockInstance<T> {
  new (...args: Parameters<T>): ReturnType<T>;
  (...args: Parameters<T>): ReturnType<T>;
}

export type MockFn = <T extends FunctionLike = FunctionLike>(fn?: T) => Mock<T>;

export type RstestUtilities = {
  /**
   * Creates a spy on a function.
   */
  fn: MockFn;
  /**
   * Creates a spy on a method of an object
   */
  spyOn: <T extends Record<string, any>, K extends keyof T>(
    obj: T,
    methodName: K,
    accessType?: 'get' | 'set',
  ) => MockInstance<T[K]>;

  /**
   * Calls `.mockClear()` on all spies.
   */
  clearAllMocks: () => RstestUtilities;
  /**
   * Calls `.mockReset()` on all spies.
   */
  resetAllMocks: () => RstestUtilities;
  /**
   * Calls `.mockRestore()` on all spies.
   */
  restoreAllMocks: () => RstestUtilities;
};
