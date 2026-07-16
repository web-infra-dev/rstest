import { promisify } from 'node:util';
import { KEYS } from './jsdomKeys';

export type NodeTimerPrimitives = Pick<
  typeof globalThis,
  'clearInterval' | 'clearTimeout' | 'setInterval' | 'setTimeout'
> & {
  AbortController: typeof globalThis.AbortController;
};

const TIMER_KEYS = [
  'clearInterval',
  'clearTimeout',
  'setInterval',
  'setTimeout',
] as const;

const SKIP_KEYS: string[] = ['window', 'self', 'top', 'parent'];

const scheduleMicrotask = queueMicrotask;
const trackedTimerErrorEvents = new WeakSet<ErrorEvent>();

function reportUnhandledError(event: ErrorEvent) {
  scheduleMicrotask(() => {
    if (!event.defaultPrevented && event.error != null) {
      Reflect.apply(process.emit, process, [
        'uncaughtExceptionMonitor',
        event.error,
        'uncaughtException',
      ]);
      Reflect.apply(process.emit, process, [
        'uncaughtException',
        event.error,
        'uncaughtException',
      ]);
    }
  });
}

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

export function installObjectURLTracker(
  URLConstructor: typeof URL,
): () => void {
  const objectURLs = new Set<string>();
  const createDescriptor = Object.getOwnPropertyDescriptor(
    URLConstructor,
    'createObjectURL',
  );
  const revokeDescriptor = Object.getOwnPropertyDescriptor(
    URLConstructor,
    'revokeObjectURL',
  );
  const createObjectURL = URLConstructor.createObjectURL;
  const revokeObjectURL = URLConstructor.revokeObjectURL;

  Object.defineProperties(URLConstructor, {
    createObjectURL: {
      value(object: Blob | MediaSource) {
        const url = createObjectURL.call(URLConstructor, object);
        objectURLs.add(url);
        return url;
      },
      configurable: true,
      writable: true,
    },
    revokeObjectURL: {
      value(url: string) {
        objectURLs.delete(url);
        revokeObjectURL.call(URLConstructor, url);
      },
      configurable: true,
      writable: true,
    },
  });

  return () => {
    for (const url of objectURLs) {
      revokeObjectURL.call(URLConstructor, url);
    }
    objectURLs.clear();

    if (createDescriptor) {
      Object.defineProperty(
        URLConstructor,
        'createObjectURL',
        createDescriptor,
      );
    } else {
      Reflect.deleteProperty(URLConstructor, 'createObjectURL');
    }
    if (revokeDescriptor) {
      Object.defineProperty(
        URLConstructor,
        'revokeObjectURL',
        revokeDescriptor,
      );
    } else {
      Reflect.deleteProperty(URLConstructor, 'revokeObjectURL');
    }
  };
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
  nodeTimers: NodeTimerPrimitives,
  domTimers?: {
    clearInterval(timer: number): void;
    clearTimeout(timer: number): void;
  },
): () => void {
  const timerCancellations = new Map<unknown, () => void>();
  const nodeTimerHandlesById = new Map<number, unknown>();
  const nodeTimerIdsByHandle = new Map<unknown, number>();
  const descriptors = new Map<
    (typeof TIMER_KEYS)[number],
    PropertyDescriptor
  >();
  const dispatchEvent = global.dispatchEvent;
  const ErrorEvent = global.ErrorEvent;
  let trackingEnabled = true;

  const registerNodeTimer = <T>(timer: T): T => {
    const id = Number(timer);
    if (Number.isFinite(id)) {
      nodeTimerHandlesById.set(id, timer);
      nodeTimerIdsByHandle.set(timer, id);
    }
    return timer;
  };
  const forgetNodeTimer = (timer: unknown) => {
    const id = nodeTimerIdsByHandle.get(timer);
    if (id !== undefined && nodeTimerHandlesById.get(id) === timer) {
      nodeTimerHandlesById.delete(id);
    }
    nodeTimerIdsByHandle.delete(timer);
  };

  const runTimerCallback = <TArgs extends unknown[]>(
    callback: (...args: TArgs) => void,
    receiver: unknown,
    args: TArgs,
  ) => {
    try {
      Reflect.apply(callback, receiver, args);
    } catch (error) {
      if (!trackingEnabled) {
        throw error;
      }
      const reportedError =
        error == null
          ? new Error(`Timer callback threw ${String(error)}`)
          : error;
      const event = new ErrorEvent('error', {
        cancelable: true,
        error: reportedError,
        message:
          reportedError instanceof Error
            ? reportedError.message
            : String(reportedError),
      });
      trackedTimerErrorEvents.add(event);
      Reflect.apply(dispatchEvent, global, [event]);
      // A listener registered before the default handler may stop propagation.
      // The caller that dispatched the event therefore owns the final decision.
      reportUnhandledError(event);
    }
  };

  const setTimeout = <TArgs extends unknown[]>(
    callback: (...args: TArgs) => void,
    delay?: number,
    ...args: TArgs
  ) => {
    if (!trackingEnabled) {
      if (typeof callback !== 'function') {
        return Reflect.apply(nodeTimers.setTimeout, global, [
          callback,
          delay,
          ...args,
        ]);
      }
      const timer = registerNodeTimer(
        nodeTimers.setTimeout(
          function (this: NodeJS.Timeout, ...callbackArgs) {
            forgetNodeTimer(this);
            Reflect.apply(callback, this, callbackArgs);
          },
          delay,
          ...args,
        ),
      );
      timer.unref();
      return timer;
    }
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
        forgetNodeTimer(this);
        refreshed = false;
        runTimerCallback(callback, this, callbackArgs);
        if (!refreshed) {
          timerCancellations.delete(this);
        }
      },
      delay,
      ...args,
    );
    registerNodeTimer(timer);
    const cancel = () => {
      forgetNodeTimer(timer);
      nodeTimers.clearTimeout(timer);
    };
    const refresh = timer.refresh;
    Object.defineProperty(timer, 'refresh', {
      configurable: true,
      value: function (this: NodeJS.Timeout, ...refreshArgs: unknown[]) {
        const result = Reflect.apply(refresh, this, refreshArgs);
        if (trackingEnabled) {
          refreshed = true;
          registerNodeTimer(this);
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
    if (!trackingEnabled) {
      const timer = registerNodeTimer(
        Reflect.apply(nodeTimers.setInterval, global, [
          callback,
          delay,
          ...args,
        ]),
      );
      timer.unref();
      return timer;
    }
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
    registerNodeTimer(timer);
    timerCancellations.set(timer, () => {
      forgetNodeTimer(timer);
      nodeTimers.clearInterval(timer);
    });
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
        options?: { ref?: boolean; signal?: AbortSignal | null } | null,
      ) => Promise<T>)
    | undefined;
  if (
    customPromisifyDescriptor &&
    typeof nativePromisifiedSetTimeout === 'function'
  ) {
    const promisifiedSetTimeout = <T>(
      delay?: number,
      value?: T,
      options?: { ref?: boolean; signal?: AbortSignal | null } | null,
    ): Promise<T> => {
      if (!trackingEnabled) {
        if (options === undefined) {
          return nativePromisifiedSetTimeout(delay, value, { ref: false });
        }
        if (options !== null && typeof options === 'object') {
          const unrefOptions = new Proxy(
            {},
            {
              get(_target, key) {
                return key === 'ref'
                  ? false
                  : Reflect.get(options, key, options);
              },
            },
          );
          return nativePromisifiedSetTimeout(delay, value, unrefOptions);
        }
        return nativePromisifiedSetTimeout(delay, value, options);
      }
      if (
        options === null ||
        (options !== undefined && typeof options !== 'object')
      ) {
        return nativePromisifiedSetTimeout(delay, value, options);
      }
      const controller = new nodeTimers.AbortController();
      const combinedSignals = new WeakMap<object, AbortSignal>();
      const originalOptions = options ?? {};
      const trackedOptions = new Proxy(
        {},
        {
          get(_target, key) {
            if (key !== 'signal') {
              return Reflect.get(originalOptions, key, originalOptions);
            }
            const signal = Reflect.get(
              originalOptions,
              key,
              originalOptions,
            ) as unknown;
            if (signal === undefined) {
              return controller.signal;
            }
            if (
              signal === null ||
              typeof signal !== 'object' ||
              !('aborted' in signal)
            ) {
              return signal;
            }
            const existing = combinedSignals.get(signal);
            if (existing) {
              return existing;
            }
            const userSignal = signal as AbortSignal;
            const combinedSignal = new Proxy({} as AbortSignal, {
              has(_target, signalKey) {
                return Reflect.has(userSignal, signalKey);
              },
              get(_target, signalKey) {
                if (signalKey === 'aborted') {
                  return (
                    Reflect.get(userSignal, signalKey, userSignal) ||
                    controller.signal.aborted
                  );
                }
                if (signalKey === 'reason') {
                  return controller.signal.aborted
                    ? controller.signal.reason
                    : Reflect.get(userSignal, signalKey, userSignal);
                }
                if (signalKey === 'addEventListener') {
                  const addEventListener = Reflect.get(
                    userSignal,
                    signalKey,
                    userSignal,
                  );
                  return (
                    ...args: Parameters<AbortSignal['addEventListener']>
                  ) => {
                    Reflect.apply(addEventListener, userSignal, args);
                    controller.signal.addEventListener(...args);
                  };
                }
                if (signalKey === 'removeEventListener') {
                  const removeEventListener = Reflect.get(
                    userSignal,
                    signalKey,
                    userSignal,
                  );
                  return (
                    ...args: Parameters<AbortSignal['removeEventListener']>
                  ) => {
                    try {
                      Reflect.apply(removeEventListener, userSignal, args);
                    } finally {
                      controller.signal.removeEventListener(...args);
                    }
                  };
                }
                return Reflect.get(userSignal, signalKey, userSignal);
              },
            });
            combinedSignals.set(signal, combinedSignal);
            return combinedSignal;
          },
        },
      );
      const nativePromise = nativePromisifiedSetTimeout(
        delay,
        value,
        trackedOptions,
      );
      let canceledByTeardown = false;
      const trackedPromise = new Promise<T>((resolve, reject) => {
        void nativePromise.then(
          (result) => {
            timerCancellations.delete(trackedPromise);
            resolve(result);
          },
          (error) => {
            timerCancellations.delete(trackedPromise);
            if (!canceledByTeardown) {
              reject(error);
            }
          },
        );
      });
      timerCancellations.set(trackedPromise, () => {
        canceledByTeardown = true;
        // Internal cancellation must not reject user-created promise chains
        // after their test environment has already been destroyed.
        controller.abort();
      });
      return trackedPromise;
    };
    Object.defineProperty(
      setTimeout,
      promisify.custom,
      'value' in customPromisifyDescriptor
        ? { ...customPromisifyDescriptor, value: promisifiedSetTimeout }
        : { ...customPromisifyDescriptor, get: () => promisifiedSetTimeout },
    );
  }

  const clearTimeout = (
    timer: Parameters<NodeTimerPrimitives['clearTimeout']>[0],
  ) => {
    const nodeTimer =
      typeof timer === 'number' ? nodeTimerHandlesById.get(timer) : timer;
    timerCancellations.delete(nodeTimer);
    if (nodeTimer !== undefined) {
      forgetNodeTimer(nodeTimer);
    }
    if (typeof timer === 'number' && nodeTimer === undefined) {
      domTimers?.clearTimeout(timer);
    }
    nodeTimers.clearTimeout(timer);
  };
  const clearInterval = (
    timer: Parameters<NodeTimerPrimitives['clearInterval']>[0],
  ) => {
    const nodeTimer =
      typeof timer === 'number' ? nodeTimerHandlesById.get(timer) : timer;
    timerCancellations.delete(nodeTimer);
    if (nodeTimer !== undefined) {
      forgetNodeTimer(nodeTimer);
    }
    if (typeof timer === 'number' && nodeTimer === undefined) {
      domTimers?.clearInterval(timer);
    }
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
  const throwUnhandledError = (e: ErrorEvent) => {
    if (!trackedTimerErrorEvents.has(e)) {
      reportUnhandledError(e);
    }
  };
  window.addEventListener('error', throwUnhandledError);
  return (): void => {
    window.removeEventListener('error', throwUnhandledError);
  };
}
