import type {
  MaybeMockedDeep,
  RstestUtilities,
  RuntimeConfig,
  WaitForOptions,
  WaitUntilOptions,
  WorkerState,
} from '../../types';
import { getRealTimers } from '../util';
import { type FakeTimerInstallOpts, FakeTimers } from './fakeTimers';
import { mockObject as mockObjectImpl } from './mockObject';
import { initSpy } from './spy';

const DEFAULT_WAIT_TIMEOUT = 1000;
const DEFAULT_WAIT_INTERVAL = 50;

const getRealSetTimeout = () =>
  getRealTimers().setTimeout ?? globalThis.setTimeout.bind(globalThis);
const getRealClearTimeout = () =>
  getRealTimers().clearTimeout ?? globalThis.clearTimeout.bind(globalThis);

const sleep = (ms: number) =>
  new Promise<void>((resolve) => getRealSetTimeout()(resolve, ms));

const createWaitForTimeoutError = (timeout: number, cause?: unknown) =>
  new Error(`waitFor timed out in ${timeout}ms`, { cause });

const createWaitUntilTimeoutError = (timeout: number) =>
  new Error(`waitUntil timed out in ${timeout}ms`);

const normalizeWaitOptions = (
  options?: number | WaitForOptions | WaitUntilOptions,
) => ({
  timeout: Math.max(
    0,
    typeof options === 'number'
      ? options
      : (options?.timeout ?? DEFAULT_WAIT_TIMEOUT),
  ),
  interval: Math.max(
    0,
    typeof options === 'number'
      ? DEFAULT_WAIT_INTERVAL
      : (options?.interval ?? DEFAULT_WAIT_INTERVAL),
  ),
});

export const createRstestUtilities: (
  workerState: WorkerState,
) => Promise<RstestUtilities> = async (workerState) => {
  type RuntimeEnvStore = Record<string, string | undefined>;
  const RSTEST_ENV_SYMBOL = Symbol.for('rstest.env');
  type GlobalWithRuntimeEnv = typeof globalThis & Record<symbol, unknown>;

  const originalEnvValues = new Map<string, string | undefined>();
  const originalGlobalValues = new Map<
    string | symbol | number,
    PropertyDescriptor | undefined
  >();

  let _timers: FakeTimers;

  let originalConfig: undefined | RuntimeConfig;

  const resolveRuntimeEnv = (): RuntimeEnvStore => {
    const globalRef = globalThis as GlobalWithRuntimeEnv;
    const runtimeEnv = globalRef[RSTEST_ENV_SYMBOL];
    if (runtimeEnv && typeof runtimeEnv === 'object') {
      return runtimeEnv as RuntimeEnvStore;
    }

    if (typeof process !== 'undefined' && process.env) {
      return process.env;
    }

    const createdEnv: RuntimeEnvStore = {};
    globalRef[RSTEST_ENV_SYMBOL] = createdEnv;
    return createdEnv;
  };

  const timers = () => {
    if (!_timers) {
      _timers = new FakeTimers({
        global: globalThis,
      });
    }
    return _timers;
  };

  const { fn, spyOn, isMockFunction, mocks, createMockInstance } = initSpy();

  const rstest: RstestUtilities = {
    fn,
    spyOn,
    isMockFunction,
    mockObject: <T>(
      value: T,
      options?: { spy?: boolean },
    ): MaybeMockedDeep<T> => {
      return mockObjectImpl(
        {
          globalConstructors: {
            Object,
            Function,
            Array,
            Map,
            RegExp,
          },
          createMockInstance,
          type: options?.spy ? 'autospy' : 'automock',
        },
        { value },
        {},
      ).value as MaybeMockedDeep<T>;
    },
    // Type helper - just returns the same item
    // The type transformation happens at compile time
    mocked: ((item: any) => item) as RstestUtilities['mocked'],
    clearAllMocks: () => {
      for (const mock of mocks) {
        mock.mockClear();
      }
      return rstest;
    },
    resetAllMocks: () => {
      for (const mock of mocks) {
        mock.mockReset();
      }
      return rstest;
    },
    restoreAllMocks: () => {
      for (const mock of mocks) {
        mock.mockRestore();
      }
      return rstest;
    },
    // The below methods are not implemented in the core package.
    // The actual implementation is managed by the built-in Rstest plugin.
    mock: () => undefined,
    mockRequire: () => undefined,
    doMock: () => undefined,
    doMockRequire: () => undefined,
    unmock: () => undefined,
    doUnmock: () => undefined,
    importMock: () => {
      // The actual implementation is managed by the built-in Rstest plugin.
      return Promise.resolve({} as any);
    },
    requireMock: () => {
      // The actual implementation is managed by the built-in Rstest plugin.
      return {} as any;
    },
    importActual: () => {
      // The actual implementation is managed by the built-in Rstest plugin.
      return Promise.resolve({} as any);
    },
    requireActual: () => {
      // The actual implementation is managed by the built-in Rstest plugin.
      return {} as any;
    },
    resetModules: () => {
      // The actual implementation is managed by the built-in Rstest plugin.
      return {} as any;
    },
    hoisted: () => {
      // The actual implementation is managed by the built-in Rstest plugin.
      return {} as any;
    },

    setConfig: (config) => {
      if (!originalConfig) {
        originalConfig = { ...workerState.runtimeConfig };
      }
      Object.assign(workerState.runtimeConfig, config);
    },

    getConfig: () => {
      const {
        testTimeout,
        hookTimeout,
        clearMocks,
        resetMocks,
        restoreMocks,
        maxConcurrency,
        retry,
      } = workerState.runtimeConfig;
      return {
        testTimeout,
        hookTimeout,
        clearMocks,
        resetMocks,
        restoreMocks,
        maxConcurrency,
        retry,
      };
    },

    resetConfig: () => {
      if (originalConfig) {
        Object.assign(workerState.runtimeConfig, originalConfig);
      }
    },

    stubEnv: (name: string, value: string | undefined): RstestUtilities => {
      const runtimeEnv = resolveRuntimeEnv();

      if (!originalEnvValues.has(name)) {
        originalEnvValues.set(name, runtimeEnv[name]);
      }

      // update runtime env store
      if (value === undefined) {
        delete runtimeEnv[name];
      } else {
        runtimeEnv[name] = value;
      }

      return rstest;
    },
    unstubAllEnvs: (): RstestUtilities => {
      const runtimeEnv = resolveRuntimeEnv();

      // restore runtime env store
      for (const [name, value] of originalEnvValues) {
        if (value === undefined) {
          delete runtimeEnv[name];
        } else {
          runtimeEnv[name] = value;
        }
      }

      originalEnvValues.clear();

      return rstest;
    },
    stubGlobal: (name: string | symbol | number, value: any) => {
      if (!originalGlobalValues.has(name)) {
        originalGlobalValues.set(
          name,
          Object.getOwnPropertyDescriptor(globalThis, name),
        );
      }
      Object.defineProperty(globalThis, name, {
        value,
        writable: true,
        configurable: true,
        enumerable: true,
      });
      return rstest;
    },
    unstubAllGlobals: () => {
      originalGlobalValues.forEach((original, name) => {
        if (!original) {
          Reflect.deleteProperty(globalThis, name);
        } else {
          Object.defineProperty(globalThis, name, original);
        }
      });
      originalGlobalValues.clear();
      return rstest;
    },
    useFakeTimers: (opts?: FakeTimerInstallOpts) => {
      timers().useFakeTimers(opts);
      return rstest;
    },
    useRealTimers: () => {
      timers().useRealTimers();
      return rstest;
    },
    setSystemTime: (now?: number | Date) => {
      timers().setSystemTime(now);
      return rstest;
    },
    getRealSystemTime: () => {
      return _timers ? timers().getRealSystemTime() : Date.now();
    },
    isFakeTimers: () => {
      return _timers ? timers().isFakeTimers() : false;
    },
    runAllTimers: () => {
      timers().runAllTimers();
      return rstest;
    },
    runAllTimersAsync: async () => {
      await timers().runAllTimersAsync();
      return rstest;
    },
    runAllTicks: () => {
      timers().runAllTicks();
      return rstest;
    },
    runOnlyPendingTimers: () => {
      timers().runOnlyPendingTimers();
      return rstest;
    },
    runOnlyPendingTimersAsync: async () => {
      await timers().runOnlyPendingTimersAsync();
      return rstest;
    },
    advanceTimersByTime: (ms: number) => {
      timers().advanceTimersByTime(ms);
      return rstest;
    },
    advanceTimersByTimeAsync: async (ms: number) => {
      await timers().advanceTimersByTimeAsync(ms);
      return rstest;
    },
    advanceTimersToNextTimer: (steps?: number) => {
      timers().advanceTimersToNextTimer(steps);
      return rstest;
    },
    advanceTimersToNextTimerAsync: async (steps?: number) => {
      await timers().advanceTimersToNextTimerAsync(steps);
      return rstest;
    },
    advanceTimersToNextFrame: () => {
      timers().advanceTimersToNextFrame();
      return rstest;
    },
    getTimerCount: () => {
      return timers().getTimerCount();
    },
    clearAllTimers: () => {
      timers().clearAllTimers();
      return rstest;
    },
    waitFor: async (callback, options) => {
      const { timeout, interval } = normalizeWaitOptions(options);
      const clearTimeoutFn = getRealClearTimeout();

      let timedOut = false;
      let lastError: unknown;

      const timeoutId = getRealSetTimeout()(() => {
        timedOut = true;
      }, timeout);

      try {
        while (true) {
          if (timedOut) {
            throw lastError ?? createWaitForTimeoutError(timeout);
          }

          try {
            const value = await callback();
            if (timedOut) {
              throw lastError ?? createWaitForTimeoutError(timeout);
            }
            return value;
          } catch (error) {
            lastError = error;
          }

          if (timedOut) {
            throw lastError ?? createWaitForTimeoutError(timeout);
          }

          await sleep(interval);
        }
      } finally {
        clearTimeoutFn(timeoutId);
      }
    },
    waitUntil: async (callback, options) => {
      const { timeout, interval } = normalizeWaitOptions(options);
      const clearTimeoutFn = getRealClearTimeout();

      let timedOut = false;
      const timeoutId = getRealSetTimeout()(() => {
        timedOut = true;
      }, timeout);

      try {
        while (true) {
          if (timedOut) {
            throw createWaitUntilTimeoutError(timeout);
          }

          const value = await callback();
          if (timedOut) {
            throw createWaitUntilTimeoutError(timeout);
          }
          if (value) {
            return value;
          }

          if (timedOut) {
            throw createWaitUntilTimeoutError(timeout);
          }

          await sleep(interval);
        }
      } finally {
        clearTimeoutFn(timeoutId);
      }
    },
  };

  return rstest;
};
