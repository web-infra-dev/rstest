import type {
  DisposableRstestUtilities,
  MaybeMockedDeep,
  RstestUtilities,
  RuntimeConfig,
  WaitForOptions,
  WaitUntilOptions,
  WorkerState,
} from '../../types';
import { RSTEST_ENV_SYMBOL_KEY } from '../../utils/constants';
import { getRealTimers } from '../util';
import type { FakeTimerInstallOpts, FakeTimersSnapshot } from './fakeTimers';
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

/**
 * Shared LIFO index-lifecycle for the three scoped-restore stacks behind
 * `stubEnv`, `stubGlobal`, and `useFakeTimers`. Each stub pushes an entry and
 * hands back a disposer; the disposer calls this to unwind. The three stacks
 * keep identical bookkeeping but distinct restore actions, so this primitive
 * owns ONLY the index management and delegates the restore itself:
 *
 *  - entry already removed (out-of-order dispose): no-op.
 *  - entry shadowed by a newer stub: forward this entry's saved payload onto
 *    the newer entry via `onSupersede` and drop this one — the live binding is
 *    left untouched because the newer stub still owns it.
 *  - entry is the newest (LIFO tail): pop it, re-apply its saved value via
 *    `onTail`, then, only when the stack has fully drained, run `onEmpty`
 *    (the two Map-backed stacks delete their now-empty key here; the bare
 *    timer array passes none).
 *
 * The per-stack supersede payload (env value vs global descriptor vs the timer
 * triple) and tail-restore action stay in the caller closures, so the
 * behavioral split between the three stacks is preserved exactly.
 */
export const restoreScopedEntry = <E>(
  stack: E[] | undefined,
  entry: E,
  handlers: {
    onSupersede: (laterEntry: E) => void;
    onTail: () => void;
    onEmpty?: () => void;
  },
): void => {
  if (!stack) {
    return;
  }
  const index = stack.lastIndexOf(entry);
  if (index === -1) {
    return;
  }

  if (index !== stack.length - 1) {
    // `index` is not the tail, so `index + 1` is always in-bounds.
    handlers.onSupersede(stack[index + 1]!);
    stack.splice(index, 1);
    return;
  }

  stack.pop();
  handlers.onTail();
  if (stack.length === 0) {
    handlers.onEmpty?.();
  }
};

export const createRstestUtilities: (
  workerState: WorkerState,
) => Promise<RstestUtilities> = async (workerState) => {
  type RuntimeEnvStore = Record<string, string | undefined>;
  const RSTEST_ENV_SYMBOL = Symbol.for(RSTEST_ENV_SYMBOL_KEY);
  type GlobalWithRuntimeEnv = typeof globalThis & Record<symbol, unknown>;
  type PropertyKey = string | symbol | number;
  type EnvStackEntry = { value: string | undefined };
  type GlobalStackEntry = { descriptor: PropertyDescriptor | undefined };
  type TimerStackEntry = {
    config: FakeTimerInstallOpts | undefined;
    snapshot: FakeTimersSnapshot | undefined;
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
    restoreScopedEntry(originalEnvValues.get(name), entry, {
      onSupersede: (laterEntry) => {
        laterEntry.value = entry.value;
      },
      onTail: () => {
        if (entry.value === undefined) {
          Reflect.deleteProperty(runtimeEnv, name);
        } else {
          runtimeEnv[name] = entry.value;
        }
      },
      onEmpty: () => originalEnvValues.delete(name),
    });
  };

  const restoreGlobalValue = (name: PropertyKey, entry: GlobalStackEntry) => {
    restoreScopedEntry(originalGlobalValues.get(name), entry, {
      onSupersede: (laterEntry) => {
        laterEntry.descriptor = entry.descriptor;
      },
      onTail: () => {
        if (!entry.descriptor) {
          Reflect.deleteProperty(globalThis, name);
        } else {
          Object.defineProperty(globalThis, name, entry.descriptor);
        }
      },
      onEmpty: () => originalGlobalValues.delete(name),
    });
  };

  const restoreFakeTimers = (entry: TimerStackEntry) => {
    restoreScopedEntry(timerStack, entry, {
      onSupersede: (laterEntry) => {
        laterEntry.config = entry.config;
        laterEntry.snapshot = entry.snapshot;
        laterEntry.wasFakeTimers = entry.wasFakeTimers;
      },
      onTail: () => {
        if (entry.wasFakeTimers) {
          timers().useFakeTimers(entry.config);
          if (entry.snapshot) {
            timers().restore(entry.snapshot);
          }
          currentFakeTimersConfig = entry.config;
        } else {
          timers().useRealTimers();
          currentFakeTimersConfig = undefined;
        }
      },
    });
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
      const timerApi = timers();
      const wasFakeTimers = timerApi.isFakeTimers();
      const entry = {
        config: currentFakeTimersConfig,
        snapshot: wasFakeTimers ? timerApi.snapshot() : undefined,
        wasFakeTimers,
      };
      timerStack.push(entry);
      timerApi.useFakeTimers(opts);
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
