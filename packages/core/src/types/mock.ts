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
  /**
   * Returns the mock name string set by calling `.mockName()`
   */
  getMockName(): string;
  /**
   * Sets the mock name for this mock.
   */
  mockName(name: string): this;
  mock: MockContext<T>;
  /**
   * Clears all information about every call.
   */
  mockClear(): this;
  /**
   * Does what `mockClear` does and resets inner implementation to the original function.
   */
  mockReset(): this;
  /**
   * Does what `mockReset` does and restores original descriptors of spied-on objects.
   */
  mockRestore(): void;
  /**
   * Returns current mock implementation if there is one.
   */
  getMockImplementation(): T | undefined;
  /**
   * Accepts a function that should be used as the implementation of the mock.
   */
  mockImplementation(fn: T): this;
  /**
   * Accepts a function that will be used as an implementation of the mock for one call to the mocked function.
   */
  mockImplementationOnce(fn: T): this;
  /**
   * Accepts a function which should be temporarily used as the implementation of the mock while the callback is being executed.
   */
  withImplementation<T2>(
    fn: T,
    callback: () => T2,
  ): T2 extends Promise<unknown> ? Promise<void> : void;
  /**
   * Return the `this` context from the method without invoking the actual implementation.
   */
  mockReturnThis(): this;
  /**
   * Accepts a value that will be returned whenever the mock function is called.
   */
  mockReturnValue(value: ReturnType<T>): this;
  /**
   * Accepts a value that will be returned for one call to the mock function.
   */
  mockReturnValueOnce(value: ReturnType<T>): this;
  /**
   * Accepts a value that will be resolved when the async function is called.
   */
  mockResolvedValue(value: Awaited<ReturnType<T>>): this;
  /**
   * Accepts a value that will be resolved during the next function call.
   */
  mockResolvedValueOnce(value: Awaited<ReturnType<T>>): this;
  /**
   * Accepts an error that will be rejected when async function is called.
   */
  mockRejectedValue(error: unknown): this;
  /**
   * Accepts a value that will be rejected during the next function call.
   */
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
   * Determines if the given function is a mocked function.
   */
  isMockFunction: (fn: any) => fn is MockInstance;

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

  /**
   * WIP: Mock a module
   */
  mock: <T = unknown>(moduleName: string, moduleFactory?: () => T) => void;

  /**
   * Changes the value of environmental variable on `process.env`.
   */
  stubEnv: (name: string, value: string | undefined) => RstestUtilities;

  /**
   * Restores all `process.env` values that were changed with `rstest.stubEnv`.
   */
  unstubAllEnvs: () => RstestUtilities;
};
