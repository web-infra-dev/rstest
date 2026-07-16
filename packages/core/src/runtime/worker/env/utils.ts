import { promisify } from 'node:util';
import { KEYS } from './jsdomKeys';

export type NodeTimers = Pick<
  typeof globalThis,
  'clearInterval' | 'clearTimeout' | 'setInterval' | 'setTimeout'
>;

const TIMER_KEYS = [
  'clearInterval',
  'clearTimeout',
  'setInterval',
  'setTimeout',
] as const;

const SKIP_KEYS: string[] = ['window', 'self', 'top', 'parent'];

function getWindowKeys(
  global: any,
  win: any,
  additionalKeys: string[] = [],
): Set<string> {
  const keysArray = [...additionalKeys, ...KEYS];

  return new Set(
    keysArray.concat(Object.getOwnPropertyNames(win)).filter((k) => {
      if (SKIP_KEYS.includes(k)) {
        return false;
      }
      if (k in global) {
        return keysArray.includes(k);
      }

      return true;
    }),
  );
}

function isClassLike(name: string) {
  return name[0] && name.startsWith(name[0].toUpperCase());
}

export function installGlobal(
  global: any,
  win: any,
  options: {
    /**
     * @default true
     */
    bindFunctions?: boolean;
    additionalKeys?: string[];
  } = {},
): () => void {
  const { bindFunctions = true } = options || {};
  const keys = getWindowKeys(global, win, options.additionalKeys);

  const originals = new Map<string | symbol, PropertyDescriptor>();

  const overrides = new Map<string | symbol, any>();
  for (const key of keys) {
    const boundFunction =
      bindFunctions &&
      typeof win[key] === 'function' &&
      !isClassLike(key) &&
      win[key].bind(win);

    if (key in global) {
      // capture the descriptor rather than the value, so that lazy native getters
      // such as Node's `localStorage` are not invoked (accessing it without
      // `--localstorage-file` emits a warning)
      originals.set(
        key,
        Object.getOwnPropertyDescriptor(global, key) ?? {
          value: global[key],
          configurable: true,
          writable: true,
          enumerable: true,
        },
      );
    }

    Object.defineProperty(global, key, {
      get() {
        if (overrides.has(key)) {
          return overrides.get(key);
        }
        if (boundFunction) {
          return boundFunction;
        }
        return win[key];
      },
      set(v) {
        overrides.set(key, v);
      },
      configurable: true,
    });
  }

  global.window = global;
  global.self = global;
  global.top = global;
  global.parent = global;

  if (global.global) {
    global.global = global;
  }

  // rewrite defaultView to reference the same global context
  if (global.document?.defaultView) {
    Object.defineProperty(global.document, 'defaultView', {
      get: () => global,
      enumerable: true,
      configurable: true,
    });
  }

  for (const k of SKIP_KEYS) {
    keys.add(k);
  }

  return () => {
    for (const key of keys) {
      Reflect.deleteProperty(global, key);
    }
    originals.forEach((descriptor, k) => {
      Object.defineProperty(global, k, descriptor);
    });
  };
}

export function installTimerTracking(
  global: typeof globalThis,
  nodeTimers: NodeTimers,
): () => void {
  const timerCancellations = new Map<unknown, () => void>();
  const descriptors = new Map<keyof NodeTimers, PropertyDescriptor>();
  let trackingEnabled = true;

  const runTimerCallback = <TArgs extends unknown[]>(
    callback: (...args: TArgs) => void,
    receiver: unknown,
    args: TArgs,
  ) => {
    try {
      Reflect.apply(callback, receiver, args);
    } catch (error) {
      const reportedError =
        error == null
          ? new Error(`Timer callback threw ${String(error)}`)
          : error;
      global.dispatchEvent(
        new global.ErrorEvent('error', {
          cancelable: true,
          error: reportedError,
          message:
            reportedError instanceof Error
              ? reportedError.message
              : String(reportedError),
        }),
      );
    }
  };

  const setTimeout = <TArgs extends unknown[]>(
    callback: (...args: TArgs) => void,
    delay?: number,
    ...args: TArgs
  ) => {
    if (typeof callback !== 'function') {
      return Reflect.apply(nodeTimers.setTimeout, global, [
        callback,
        delay,
        ...args,
      ]);
    }

    let refreshed = false;
    const timer = nodeTimers.setTimeout(
      function (this: NodeJS.Timeout, ...callbackArgs) {
        refreshed = false;
        runTimerCallback(callback, this, callbackArgs);
        if (!refreshed) {
          timerCancellations.delete(this);
        }
      },
      delay,
      ...args,
    );
    const cancel = () => nodeTimers.clearTimeout(timer);
    const refresh = timer.refresh;
    Object.defineProperty(timer, 'refresh', {
      configurable: true,
      value: function (this: NodeJS.Timeout, ...refreshArgs: unknown[]) {
        const result = Reflect.apply(refresh, this, refreshArgs);
        if (trackingEnabled) {
          refreshed = true;
          timerCancellations.set(this, cancel);
        }
        return result;
      },
      writable: true,
    });
    timerCancellations.set(timer, cancel);
    return timer;
  };
  const setInterval = <TArgs extends unknown[]>(
    callback: (...args: TArgs) => void,
    delay?: number,
    ...args: TArgs
  ) => {
    if (typeof callback !== 'function') {
      return Reflect.apply(nodeTimers.setInterval, global, [
        callback,
        delay,
        ...args,
      ]);
    }

    const timer = nodeTimers.setInterval(
      function (this: unknown, ...callbackArgs) {
        runTimerCallback(callback, this, callbackArgs);
      },
      delay,
      ...args,
    );
    timerCancellations.set(timer, () => nodeTimers.clearInterval(timer));
    return timer;
  };

  const customPromisifyDescriptor = Object.getOwnPropertyDescriptor(
    nodeTimers.setTimeout,
    promisify.custom,
  );
  const nativePromisifiedSetTimeout = Reflect.get(
    nodeTimers.setTimeout,
    promisify.custom,
  ) as
    | (<T>(
        delay?: number,
        value?: T,
        options?: { ref?: boolean; signal?: AbortSignal },
      ) => Promise<T>)
    | undefined;
  if (
    customPromisifyDescriptor &&
    typeof nativePromisifiedSetTimeout === 'function'
  ) {
    const promisifiedSetTimeout = <T>(
      delay?: number,
      value?: T,
      options?: { ref?: boolean; signal?: AbortSignal },
    ): Promise<T> => {
      if (
        options === null ||
        (options !== undefined && typeof options !== 'object')
      ) {
        return nativePromisifiedSetTimeout(delay, value, options);
      }
      const signal =
        options !== null && typeof options === 'object'
          ? options.signal
          : undefined;
      if (
        signal !== undefined &&
        (typeof signal.addEventListener !== 'function' ||
          typeof signal.removeEventListener !== 'function' ||
          typeof signal.aborted !== 'boolean')
      ) {
        return nativePromisifiedSetTimeout(delay, value, options);
      }
      if (signal?.aborted) {
        return nativePromisifiedSetTimeout(delay, value, options);
      }

      const controller = new AbortController();
      const onAbort = () => controller.abort(signal?.reason);
      signal?.addEventListener('abort', onAbort, { once: true });
      const nativePromise = nativePromisifiedSetTimeout(delay, value, {
        ...options,
        signal: controller.signal,
      });
      const trackedPromise = nativePromise.finally(() => {
        signal?.removeEventListener('abort', onAbort);
        timerCancellations.delete(trackedPromise);
      });
      timerCancellations.set(trackedPromise, () => {
        signal?.removeEventListener('abort', onAbort);
        // Teardown owns this cancellation, so do not report its AbortError as
        // an unhandled rejection when the test intentionally ignored the sleep.
        void trackedPromise.catch(() => {});
        controller.abort();
      });
      return trackedPromise;
    };
    Object.defineProperty(setTimeout, promisify.custom, {
      configurable: customPromisifyDescriptor.configurable,
      enumerable: customPromisifyDescriptor.enumerable,
      value: promisifiedSetTimeout,
      writable: false,
    });
  }

  const clearTimeout = (timer: Parameters<NodeTimers['clearTimeout']>[0]) => {
    timerCancellations.delete(timer);
    nodeTimers.clearTimeout(timer);
  };
  const clearInterval = (timer: Parameters<NodeTimers['clearInterval']>[0]) => {
    timerCancellations.delete(timer);
    nodeTimers.clearInterval(timer);
  };

  const trackedTimers = {
    clearInterval,
    clearTimeout,
    setInterval,
    setTimeout,
  };
  for (const key of TIMER_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(global, key);
    if (descriptor) {
      descriptors.set(key, descriptor);
    }
    Object.defineProperty(global, key, {
      configurable: true,
      value: trackedTimers[key],
      writable: true,
    });
  }

  return () => {
    trackingEnabled = false;
    for (const cancel of timerCancellations.values()) {
      cancel();
    }
    timerCancellations.clear();
    for (const key of TIMER_KEYS) {
      const descriptor = descriptors.get(key);
      if (descriptor) {
        Object.defineProperty(global, key, descriptor);
      } else {
        Reflect.deleteProperty(global, key);
      }
    }
  };
}

export function addDefaultErrorHandler(window: Window) {
  const scheduleMicrotask = queueMicrotask;
  const throwUnhandledError = (e: ErrorEvent) => {
    // Event listeners run in registration order, so cancellation may happen
    // after this default listener is invoked. Defer reporting until dispatch
    // has completed and only suppress errors explicitly handled with
    // preventDefault(). Merely observing the event must not make a test pass.
    scheduleMicrotask(() => {
      if (!e.defaultPrevented && e.error != null) {
        process.emit('uncaughtException', e.error);
      }
    });
  };
  window.addEventListener('error', throwUnhandledError);
  return (): void => {
    window.removeEventListener('error', throwUnhandledError);
  };
}
