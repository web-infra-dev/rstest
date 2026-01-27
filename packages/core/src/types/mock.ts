import type { FakeTimerInstallOpts } from '@sinonjs/fake-timers';
import type { FunctionLike, MaybePromise } from './utils';
import type { RuntimeConfig } from './worker';

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

type MockSettledResult<T> =
  | MockSettledResultFulfilled<T>
  | MockSettledResultRejected;

type RuntimeOptions = Partial<
  Pick<
    RuntimeConfig,
    | 'testTimeout'
    | 'hookTimeout'
    | 'clearMocks'
    | 'resetMocks'
    | 'restoreMocks'
    | 'maxConcurrency'
    | 'retry'
  >
>;

export type MockContext<T extends FunctionLike = FunctionLike> = {
  /**
   * List of the call arguments of all calls that have been made to the mock.
   */
  calls: Parameters<T>[];
  /**
   * List of all the object instances that have been instantiated from the mock.
   */
  instances: ReturnType<T>[];
  /**
   * List of all the function contexts that have been applied to calls to the mock.
   */
  contexts: ThisParameterType<T>[];
  /**
   * The order of mock's execution.
   * This returns an array of numbers which are shared between all defined mocks.
   * The index is starting with `1`.
   */
  invocationCallOrder: number[];
  /**
   * List of the call arguments of the last call that was made to the mock.
   * If the function was not called, it will return `undefined`.
   */
  lastCall: Parameters<T> | undefined;
  /**
   * List of the results of all calls that have been made to the mock.
   */
  results: MockResult<ReturnType<T>>[];

  /**
   * List of the results of all values that were `resolved` or `rejected` from the function.
   */
  settledResults: MockSettledResult<Awaited<ReturnType<T>>>[];
};

type Procedure = (...args: any[]) => any;
// pick a single function type from function overloads, unions, etc...
export type NormalizedProcedure<T extends Procedure> = (
  ...args: Parameters<T>
) => ReturnType<T>;

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
  getMockImplementation(): NormalizedProcedure<T> | undefined;
  /**
   * Accepts a function that should be used as the implementation of the mock.
   */
  mockImplementation(fn: NormalizedProcedure<T>): this;
  /**
   * Accepts a function that will be used as an implementation of the mock for one call to the mocked function.
   */
  mockImplementationOnce(fn: NormalizedProcedure<T>): this;
  /**
   * Accepts a function which should be temporarily used as the implementation of the mock while the callback is being executed.
   */
  withImplementation<T2>(
    fn: NormalizedProcedure<T>,
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
type MockFactory<T = unknown> = () => MaybePromise<Partial<T>>;

/**
 * Options for mockObject
 */
export interface MockOptions {
  /**
   * If `true`, the original implementation will be kept.
   * All methods will call the original implementation, but you can still track the calls.
   */
  spy?: boolean;
}

/**
 * Options for rs.mock module mocking.
 * Supports `{ spy: true }` or `{ mock: true }`.
 */
export type MockModuleOptions =
  | {
      /**
       * If `true`, the module will be auto-mocked but the original implementations
       * will be preserved - all exports will be wrapped in spy functions that track calls.
       */
      spy: true;
    }
  | {
      /**
       * If `true`, the module will be auto-mocked with all exports replaced by mock functions.
       * Original implementations will NOT be preserved.
       */
      mock: true;
    };

// Helper types for mocking
type MockProcedure = (...args: any[]) => any;

// Type for class constructors
type Constructor<T = any> = new (...args: any[]) => T;

// Mocked class constructor type - preserves both the constructor signature and mock capabilities
export type MockedClass<T extends Constructor> = Mock<
  (...args: ConstructorParameters<T>) => InstanceType<T>
> & {
  new (...args: ConstructorParameters<T>): InstanceType<T>;
  prototype: InstanceType<T>;
};

type Methods<T> = {
  [K in keyof T]: T[K] extends MockProcedure ? K : never;
}[keyof T];

type Properties<T> = {
  [K in keyof T]: T[K] extends MockProcedure ? never : K;
}[keyof T];

export type MockedFunction<T extends MockProcedure> = Mock<T> & {
  [K in keyof T]: T[K];
};

export type MockedFunctionDeep<T extends MockProcedure> = Mock<T> &
  MockedObjectDeep<T>;

export type MockedObject<T> = {
  [K in Methods<T>]: T[K] extends MockProcedure ? MockedFunction<T[K]> : T[K];
} & { [K in Properties<T>]: T[K] };

export type MockedObjectDeep<T> = {
  [K in Methods<T>]: T[K] extends MockProcedure
    ? MockedFunctionDeep<T[K]>
    : T[K];
} & { [K in Properties<T>]: MaybeMockedDeep<T[K]> };

export type Mocked<T> = T extends Constructor
  ? MockedClass<T>
  : T extends MockProcedure
    ? MockedFunction<T>
    : T extends object
      ? MockedObject<T>
      : T;

export type MaybeMockedDeep<T> = T extends Constructor
  ? MockedClass<T>
  : T extends MockProcedure
    ? MockedFunctionDeep<T>
    : T extends object
      ? MockedObjectDeep<T>
      : T;

export type MaybePartiallyMocked<T> = T extends Constructor
  ? MockedClass<T>
  : T extends MockProcedure
    ? MockedFunction<T>
    : T extends object
      ? MockedObject<T>
      : T;

export type MaybePartiallyMockedDeep<T> = T extends Constructor
  ? MockedClass<T>
  : T extends MockProcedure
    ? MockedFunctionDeep<T>
    : T extends object
      ? MockedObjectDeep<T>
      : T;

export interface RstestUtilities {
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
   * Deeply mocks properties and methods of a given object
   * in the same way as `rstest.mock()` mocks module exports.
   *
   * @example
   * ```ts
   * const original = {
   *   simple: () => 'value',
   *   nested: {
   *     method: () => 'real'
   *   },
   *   prop: 'foo',
   * }
   *
   * const mocked = rstest.mockObject(original)
   * expect(mocked.simple()).toBe(undefined)
   * expect(mocked.nested.method()).toBe(undefined)
   * expect(mocked.prop).toBe('foo')
   *
   * mocked.simple.mockReturnValue('mocked')
   * expect(mocked.simple()).toBe('mocked')
   *
   * // With spy option to keep original implementations
   * const spied = rstest.mockObject(original, { spy: true })
   * expect(spied.simple()).toBe('value')
   * expect(spied.simple).toHaveBeenCalled()
   * ```
   *
   * @param value - The object to be mocked
   * @param options - Mock options
   * @returns A deeply mocked version of the input object
   */
  mockObject: <T>(value: T, options?: MockOptions) => MaybeMockedDeep<T>;

  /**
   * Type helper for TypeScript. Just returns the object that was passed.
   *
   * When `partial` is `true` it will expect a `Partial<T>` as a return value.
   * By default, this will only make TypeScript believe that the first level values are mocked.
   * You can pass down `{ deep: true }` as a second argument to tell TypeScript
   * that the whole object is mocked, if it actually is.
   *
   * @example
   * ```ts
   * import example from './example.js'
   *
   * rstest.mock('./example.js')
   *
   * test('1 + 1 equals 10', async () => {
   *   rstest.mocked(example.calc).mockReturnValue(10)
   *   expect(example.calc(1, '+', 1)).toBe(10)
   * })
   * ```
   * @param item - Anything that can be mocked
   * @returns The same item with mocked type
   */
  mocked: (<T>(item: T, deep?: false) => Mocked<T>) &
    (<T>(item: T, deep: true) => MaybeMockedDeep<T>) &
    (<T>(item: T, options: { partial?: false; deep?: false }) => Mocked<T>) &
    (<T>(
      item: T,
      options: { partial?: false; deep: true },
    ) => MaybeMockedDeep<T>) &
    (<T>(
      item: T,
      options: { partial: true; deep?: false },
    ) => MaybePartiallyMocked<T>) &
    (<T>(
      item: T,
      options: { partial: true; deep: true },
    ) => MaybePartiallyMockedDeep<T>);

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
   * Mock a module.
   *
   * When called with a factory function, the module will be replaced with the return value of the factory.
   * When called with `{ spy: true }`, the module will be auto-mocked but the original implementations
   * will be preserved - all exports will be wrapped in spy functions that track calls.
   *
   * @example
   * ```ts
   * // Replace module with factory
   * rs.mock('./module', () => ({ fn: rs.fn() }))
   *
   * // Auto-mock with spy mode - keeps original implementations
   * rs.mock('./module', { spy: true })
   * ```
   */
  mock<T = unknown>(
    moduleName: string | Promise<T>,
    factoryOrOptions?: MockFactory<T> | MockModuleOptions,
  ): void;

  /**
   * Mock a module (CommonJS require)
   */
  mockRequire: <T = unknown>(
    moduleName: string,
    factoryOrOptions?: (() => T) | MockModuleOptions,
  ) => void;

  /**
   * Mock a module, not hoisted.
   *
   * When called with `{ spy: true }`, the module will be auto-mocked but the original implementations
   * will be preserved - all exports will be wrapped in spy functions that track calls.
   */
  doMock<T = unknown>(
    moduleName: string | Promise<T>,
    factoryOrOptions?: MockFactory<T> | MockModuleOptions,
  ): void;

  /**
   * Mock a module, not hoisted (CommonJS require).
   */
  doMockRequire: <T = unknown>(
    moduleName: string,
    factoryOrOptions?: (() => T) | MockModuleOptions,
  ) => void;

  /**
   * Hoisted mock function.
   */
  hoisted: <T = unknown>(fn: () => T) => T;

  /**
   * Removes module from the mocked registry.
   */
  unmock: (path: string) => void;

  /**
   * Removes module from the mocked registry, not hoisted.
   */
  doUnmock: (path: string) => void;

  /**
   * Imports a module with all of its properties (including nested properties) mocked.
   */
  importMock: <T = Record<string, unknown>>(path: string) => Promise<T>;

  /**
   * Imports a module with all of its properties (including nested properties) mocked.
   */
  requireMock: <T = Record<string, unknown>>(path: string) => T;

  /**
   * Import and return the actual module instead of a mock, bypassing all checks on whether the module should receive a mock implementation or not.
   */
  importActual: <T = Record<string, unknown>>(path: string) => Promise<T>;

  /**
   * Require and return the actual module instead of a mock, bypassing all checks on whether the module should receive a mock implementation or not.
   */
  requireActual: <T = Record<string, unknown>>(path: string) => T;

  /**
   * Resets modules registry by clearing the cache of all modules.
   */
  resetModules: () => RstestUtilities;

  /**
   * Changes the value of environmental variable on `process.env`.
   */
  stubEnv: (name: string, value: string | undefined) => RstestUtilities;

  /**
   * Restores all `process.env` values that were changed with `rstest.stubEnv`.
   */
  unstubAllEnvs: () => RstestUtilities;

  /**
   * Changes the value of global variable.
   */
  stubGlobal: (
    name: string | number | symbol,
    value: unknown,
  ) => RstestUtilities;

  /**
   * Restores all global variables that were changed with `rstest.stubGlobal`.
   */
  unstubAllGlobals: () => RstestUtilities;

  /**
   * Update runtime config for the current test.
   */
  setConfig: (config: RuntimeOptions) => void;

  /**
   * get runtime config for the current test.
   */
  getConfig: () => RuntimeOptions;

  /**
   * Reset runtime config that were changed with `rstest.setConfig`.
   */
  resetConfig: () => void;

  /**
   * Mocks timers using `@sinonjs/fake-timers`.
   */
  useFakeTimers: (config?: FakeTimerInstallOpts) => RstestUtilities;
  useRealTimers: () => RstestUtilities;
  isFakeTimers: () => boolean;
  /**
   * Set the current system time used by fake timers.
   */
  setSystemTime: (now?: number | Date) => RstestUtilities;
  getRealSystemTime: () => number;

  runAllTicks: () => RstestUtilities;
  runAllTimers: () => RstestUtilities;
  runAllTimersAsync: () => Promise<RstestUtilities>;
  runOnlyPendingTimers: () => RstestUtilities;
  runOnlyPendingTimersAsync: () => Promise<RstestUtilities>;

  advanceTimersByTime: (ms: number) => RstestUtilities;
  advanceTimersByTimeAsync: (ms: number) => Promise<RstestUtilities>;
  advanceTimersToNextTimer: (steps?: number) => RstestUtilities;
  advanceTimersToNextTimerAsync: (steps?: number) => Promise<RstestUtilities>;
  advanceTimersToNextFrame: () => RstestUtilities;

  /**
   * Returns the number of fake timers still left to run.
   */
  getTimerCount: () => number;
  /**
   * Removes all timers that are scheduled to run.
   */
  clearAllTimers: () => RstestUtilities;
}
