import type {
  DisposableRstestUtilities,
  MaybeMockedDeep,
  RstestUtilities,
  RuntimeConfig,
  WaitForOptions,
  WaitUntilOptions,
  WorkerState,
} from '../../types';
import { getRealTimers } from '../util';
import type { FakeTimerInstallOpts } from './fakeTimers';
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
  type PropertyKey = string | symbol | number;
  type EnvStackEntry = { value: string | undefined };
  type GlobalStackEntry = { descriptor: PropertyDescriptor | undefined };
  type TimerStackEntry = {
    config: FakeTimerInstallOpts | undefined;
    now: number | undefined;
    wasFakeTimers: boolean;
  };

  const originalEnvValues = new Map<string, EnvStackEntry[]>();
  const originalGlobalValues = new Map<PropertyKey, GlobalStackEntry[]>();
  const timerStack: TimerStackEntry[] = [];

  const { FakeTimers } = await import(
    /* webpackChunkName: "fake-timers" */ './fakeTimers'
  );

  let _timers: InstanceType<typeof FakeTimers>;
  let currentFakeTimersConfig: FakeTimerInstallOpts | undefined;

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

  const createDisposableRstestUtilities = (
    dispose: () => void,
  ): DisposableRstestUtilities => {
    let disposed = false;
    const disposers = [dispose];
    const disposableRstest = Object.create(rstest) as DisposableRstestUtilities;

    const addDisposable = (next: DisposableRstestUtilities) => {
      if (Symbol.dispose) {
        disposers.push(() => next[Symbol.dispose]());
      }
      return disposableRstest;
    };

    disposableRstest.stubEnv = (name, value) => {
      return addDisposable(rstest.stubEnv(name, value));
    };
    disposableRstest.stubGlobal = (name, value) => {
      return addDisposable(rstest.stubGlobal(name, value));
    };
    disposableRstest.useFakeTimers = (opts) => {
      return addDisposable(rstest.useFakeTimers(opts));
    };

    if (Symbol.dispose) {
      Object.defineProperty(disposableRstest, Symbol.dispose, {
        configurable: true,
        value: () => {
          if (!disposed) {
            disposed = true;
            for (let index = disposers.length - 1; index >= 0; index--) {
              disposers[index]?.();
            }
          }
        },
      });
    }
    return disposableRstest;
  };

  const restoreEnvValue = (name: string, entry: EnvStackEntry) => {
    const runtimeEnv = resolveRuntimeEnv();
    const envStack = originalEnvValues.get(name);
    const index = envStack?.lastIndexOf(entry) ?? -1;
    if (!envStack || index === -1) {
      return;
    }

    if (index !== envStack.length - 1) {
      const nextEntry = envStack[index + 1];
      if (nextEntry) {
        nextEntry.value = entry.value;
      }
      envStack.splice(index, 1);
      return;
    }

    envStack.pop();
    if (entry.value === undefined) {
      Reflect.deleteProperty(runtimeEnv, name);
    } else {
      runtimeEnv[name] = entry.value;
    }

    if (envStack.length === 0) {
      originalEnvValues.delete(name);
    }
  };

  const restoreGlobalValue = (name: PropertyKey, entry: GlobalStackEntry) => {
    const descriptorStack = originalGlobalValues.get(name);
    const index = descriptorStack?.lastIndexOf(entry) ?? -1;
    if (!descriptorStack || index === -1) {
      return;
    }

    if (index !== descriptorStack.length - 1) {
      const nextEntry = descriptorStack[index + 1];
      if (nextEntry) {
        nextEntry.descriptor = entry.descriptor;
      }
      descriptorStack.splice(index, 1);
      return;
    }

    descriptorStack.pop();
    if (!entry.descriptor) {
      Reflect.deleteProperty(globalThis, name);
    } else {
      Object.defineProperty(globalThis, name, entry.descriptor);
    }

    if (descriptorStack.length === 0) {
      originalGlobalValues.delete(name);
    }
  };

  const restoreFakeTimers = (entry: TimerStackEntry) => {
    const index = timerStack.lastIndexOf(entry);
    if (index === -1) {
      return;
    }

    if (index !== timerStack.length - 1) {
      const nextEntry = timerStack[index + 1];
      if (nextEntry) {
        nextEntry.config = entry.config;
        nextEntry.now = entry.now;
        nextEntry.wasFakeTimers = entry.wasFakeTimers;
      }
      timerStack.splice(index, 1);
      return;
    }

    timerStack.pop();
    if (entry.wasFakeTimers) {
      timers().useFakeTimers(entry.config);
      if (entry.now !== undefined) {
        timers().setSystemTime(entry.now);
      }
      currentFakeTimersConfig = entry.config;
    } else {
      timers().useRealTimers();
      currentFakeTimersConfig = undefined;
    }
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
    unmockRequire: () => undefined,
    doUnmockRequire: () => undefined,
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

    stubEnv: (name: string, value: string | undefined) => {
      const runtimeEnv = resolveRuntimeEnv();
      const envStack = originalEnvValues.get(name) ?? [];
      const entry = { value: runtimeEnv[name] };
      envStack.push(entry);
      originalEnvValues.set(name, envStack);

      if (value === undefined) {
        Reflect.deleteProperty(runtimeEnv, name);
      } else {
        runtimeEnv[name] = value;
      }

      return createDisposableRstestUtilities(() =>
        restoreEnvValue(name, entry),
      );
    },
    unstubAllEnvs: (): RstestUtilities => {
      const runtimeEnv = resolveRuntimeEnv();

      for (const [name, envStack] of originalEnvValues) {
        const entry = envStack[0];
        if (!entry) {
          continue;
        }
        if (entry.value === undefined) {
          Reflect.deleteProperty(runtimeEnv, name);
        } else {
          runtimeEnv[name] = entry.value;
        }
      }

      originalEnvValues.clear();

      return rstest;
    },
    stubGlobal: (name: string | symbol | number, value: any) => {
      const descriptorStack = originalGlobalValues.get(name) ?? [];
      const entry = {
        descriptor: Object.getOwnPropertyDescriptor(globalThis, name),
      };
      descriptorStack.push(entry);
      originalGlobalValues.set(name, descriptorStack);
      Object.defineProperty(globalThis, name, {
        value,
        writable: true,
        configurable: true,
        enumerable: true,
      });
      return createDisposableRstestUtilities(() =>
        restoreGlobalValue(name, entry),
      );
    },
    unstubAllGlobals: () => {
      originalGlobalValues.forEach((descriptorStack, name) => {
        const original = descriptorStack[0];
        if (!original) {
          return;
        }
        if (!original.descriptor) {
          Reflect.deleteProperty(globalThis, name);
        } else {
          Object.defineProperty(globalThis, name, original.descriptor);
        }
      });
      originalGlobalValues.clear();
      return rstest;
    },
    useFakeTimers: (opts?: FakeTimerInstallOpts) => {
      const wasFakeTimers = _timers ? timers().isFakeTimers() : false;
      const entry = {
        config: currentFakeTimersConfig,
        now: wasFakeTimers ? timers().now() : undefined,
        wasFakeTimers,
      };
      timerStack.push(entry);
      timers().useFakeTimers(opts);
      currentFakeTimersConfig = opts;
      return createDisposableRstestUtilities(() => restoreFakeTimers(entry));
    },
    useRealTimers: () => {
      timers().useRealTimers();
      currentFakeTimersConfig = undefined;
      timerStack.length = 0;
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
