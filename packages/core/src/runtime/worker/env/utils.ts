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
const trackedTimerLifecycleByHandle = new WeakMap<
  object,
  { forget(): void; rearm(): void }
>();
const activeNodeTimerHandlesById = new Map<number, object>();
const activeNodeTimerIdsByHandle = new WeakMap<object, number>();

function patchTimerLifecycleMethods<T extends NodeJS.Timeout>(timer: T): T {
  for (const key of ['close', Symbol.dispose] as const) {
    const method = Reflect.get(timer, key, timer);
    if (typeof method !== 'function') {
      continue;
    }
    const descriptor =
      Object.getOwnPropertyDescriptor(timer, key) ??
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(timer), key);
    Object.defineProperty(timer, key, {
      configurable: descriptor?.configurable ?? true,
      enumerable: descriptor?.enumerable,
      value: function (this: NodeJS.Timeout, ...args: unknown[]) {
        const result = Reflect.apply(method, this, args);
        trackedTimerLifecycleByHandle.get(this)?.forget();
        return result;
      },
      writable: descriptor?.writable ?? true,
    });
  }
  const refresh = timer.refresh;
  const refreshDescriptor =
    Object.getOwnPropertyDescriptor(timer, 'refresh') ??
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(timer), 'refresh');
  Object.defineProperty(timer, 'refresh', {
    configurable: refreshDescriptor?.configurable ?? true,
    enumerable: refreshDescriptor?.enumerable,
    value: function (this: NodeJS.Timeout, ...args: unknown[]) {
      const result = Reflect.apply(refresh, this, args);
      trackedTimerLifecycleByHandle.get(this)?.rearm();
      return result;
    },
    writable: refreshDescriptor?.writable ?? true,
  });
  return timer;
}

function reportUnhandledError(error: unknown, isPrevented: () => boolean) {
  scheduleMicrotask(() => {
    if (!isPrevented() && error != null) {
      Reflect.apply(process.emit, process, [
        'uncaughtExceptionMonitor',
        error,
        'uncaughtException',
      ]);
      Reflect.apply(process.emit, process, [
        'uncaughtException',
        error,
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
  const descriptors = new Map<
    (typeof TIMER_KEYS)[number],
    PropertyDescriptor
  >();
  const dispatchEvent = global.dispatchEvent;
  const ErrorEvent = global.ErrorEvent;
  const abortControllerPrototype = nodeTimers.AbortController.prototype;
  const abortControllerAbort = Reflect.get(
    abortControllerPrototype,
    'abort',
    abortControllerPrototype,
  ) as AbortController['abort'];
  const abortControllerSignalGetter = Object.getOwnPropertyDescriptor(
    abortControllerPrototype,
    'signal',
  )?.get;
  const signalProbeController = new nodeTimers.AbortController();
  const getAbortSignal = (controller: AbortController): AbortSignal =>
    abortControllerSignalGetter
      ? Reflect.apply(abortControllerSignalGetter, controller, [])
      : controller.signal;
  const signalProbe = getAbortSignal(signalProbeController);
  const abortSignalPrototype = Object.getPrototypeOf(signalProbe);
  const abortSignalAbortedGetter = Object.getOwnPropertyDescriptor(
    abortSignalPrototype,
    'aborted',
  )?.get;
  const abortSignalReasonGetter = Object.getOwnPropertyDescriptor(
    abortSignalPrototype,
    'reason',
  )?.get;
  const abortSignalAddEventListener = Reflect.get(
    signalProbe,
    'addEventListener',
    signalProbe,
  ) as AbortSignal['addEventListener'];
  const abortSignalRemoveEventListener = Reflect.get(
    signalProbe,
    'removeEventListener',
    signalProbe,
  ) as AbortSignal['removeEventListener'];
  let trackingEnabled = true;

  const createTeardownController = () => {
    const controller = new nodeTimers.AbortController();
    const signal = getAbortSignal(controller);
    const safeSignal = new Proxy(signal, {
      has(target, key) {
        if (key === 'aborted') {
          return true;
        }
        return Reflect.has(target, key);
      },
      get(target, key) {
        if (key === 'aborted' && abortSignalAbortedGetter) {
          return Reflect.apply(abortSignalAbortedGetter, target, []);
        }
        if (key === 'reason' && abortSignalReasonGetter) {
          return Reflect.apply(abortSignalReasonGetter, target, []);
        }
        if (key === 'addEventListener') {
          return (...args: Parameters<AbortSignal['addEventListener']>) =>
            Reflect.apply(abortSignalAddEventListener, target, args);
        }
        if (key === 'removeEventListener') {
          return (...args: Parameters<AbortSignal['removeEventListener']>) =>
            Reflect.apply(abortSignalRemoveEventListener, target, args);
        }
        return Reflect.get(target, key, target);
      },
    });
    return {
      abort: (reason: unknown) =>
        Reflect.apply(abortControllerAbort, controller, [reason]),
      signal: safeSignal,
    };
  };

  const forgetNodeTimer = (timer: object) => {
    const id = activeNodeTimerIdsByHandle.get(timer);
    if (id !== undefined && activeNodeTimerHandlesById.get(id) === timer) {
      activeNodeTimerHandlesById.delete(id);
    }
    activeNodeTimerIdsByHandle.delete(timer);
  };
  const forgetTrackedNodeTimer = (timer: NodeJS.Timeout) => {
    timerCancellations.delete(timer);
    forgetNodeTimer(timer);
  };
  const registerNodeTimer = <T extends NodeJS.Timeout>(timer: T): T => {
    let id: number;
    try {
      id = Number(timer);
    } catch {
      return timer;
    }
    if (Number.isFinite(id)) {
      activeNodeTimerHandlesById.set(id, timer);
      activeNodeTimerIdsByHandle.set(timer, id);
    }
    return timer;
  };
  const trackNodeTimer = <T extends NodeJS.Timeout>(
    timer: T,
    clearTimer: (timer: T) => void,
  ): T => {
    const cancel = () => {
      forgetTrackedNodeTimer(timer);
      clearTimer(timer);
    };
    const lifecycle = {
      forget: () => forgetTrackedNodeTimer(timer),
      rearm: () => {
        registerNodeTimer(timer);
        if (trackingEnabled) {
          timerCancellations.set(timer, cancel);
        } else {
          timer.unref();
        }
      },
    };
    trackedTimerLifecycleByHandle.set(timer, lifecycle);
    patchTimerLifecycleMethods(timer);
    lifecycle.rearm();
    return timer;
  };
  const resolveTrackedNodeTimer = (timer: unknown) => {
    if (
      typeof timer === 'object' &&
      timer !== null &&
      trackedTimerLifecycleByHandle.has(timer)
    ) {
      return timer;
    }
    if (typeof timer === 'number') {
      const id = Number(timer);
      if (Number.isFinite(id)) {
        return activeNodeTimerHandlesById.get(id);
      }
    }
    if (typeof timer === 'string') {
      const id = Number(timer);
      if (Number.isFinite(id) && timer === String(id)) {
        return activeNodeTimerHandlesById.get(id);
      }
    }
    return undefined;
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
      let message: string;
      try {
        message = String(
          reportedError instanceof Error
            ? reportedError.message
            : reportedError,
        );
      } catch {
        message = 'Timer callback threw an unprintable value';
      }
      const event = new ErrorEvent('error', {
        cancelable: true,
        error: reportedError,
        message,
      });
      trackedTimerErrorEvents.add(event);
      Reflect.apply(dispatchEvent, global, [event]);
      // A listener registered before the default handler may stop propagation.
      // The caller that dispatched the event therefore owns the final decision.
      if (!event.defaultPrevented) {
        throw reportedError;
      }
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
      return trackNodeTimer(
        nodeTimers.setTimeout(
          function (this: NodeJS.Timeout, ...callbackArgs) {
            forgetTrackedNodeTimer(this);
            Reflect.apply(callback, this, callbackArgs);
          },
          delay,
          ...args,
        ),
        (timer) => nodeTimers.clearTimeout(timer),
      );
    }
    if (typeof callback !== 'function') {
      return Reflect.apply(nodeTimers.setTimeout, global, [
        callback,
        delay,
        ...args,
      ]);
    }

    return trackNodeTimer(
      nodeTimers.setTimeout(
        function (this: NodeJS.Timeout, ...callbackArgs) {
          forgetTrackedNodeTimer(this);
          runTimerCallback(callback, this, callbackArgs);
        },
        delay,
        ...args,
      ),
      (timer) => nodeTimers.clearTimeout(timer),
    );
  };
  const setInterval = <TArgs extends unknown[]>(
    callback: (...args: TArgs) => void,
    delay?: number,
    ...args: TArgs
  ) => {
    if (!trackingEnabled) {
      return trackNodeTimer(
        Reflect.apply(nodeTimers.setInterval, global, [
          callback,
          delay,
          ...args,
        ]),
        (timer) => nodeTimers.clearInterval(timer),
      );
    }
    if (typeof callback !== 'function') {
      return Reflect.apply(nodeTimers.setInterval, global, [
        callback,
        delay,
        ...args,
      ]);
    }

    return trackNodeTimer(
      nodeTimers.setInterval(
        function (this: unknown, ...callbackArgs) {
          runTimerCallback(callback, this, callbackArgs);
        },
        delay,
        ...args,
      ),
      (timer) => nodeTimers.clearInterval(timer),
    );
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
                const value = Reflect.get(options, key, options);
                if (key !== 'ref') {
                  return value;
                }
                return value === undefined || typeof value === 'boolean'
                  ? false
                  : value;
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
      const teardownController = createTeardownController();
      let abortSource: 'teardown' | 'user' | undefined;
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
              return teardownController.signal;
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
            const abortListenerWrappers = new WeakMap<
              object,
              {
                teardown: (...args: unknown[]) => unknown;
                user: (...args: unknown[]) => unknown;
              }
            >();
            const combinedSignal = new Proxy({} as AbortSignal, {
              has(_target, signalKey) {
                return Reflect.has(userSignal, signalKey);
              },
              get(_target, signalKey) {
                if (signalKey === 'aborted') {
                  return (
                    Reflect.get(userSignal, signalKey, userSignal) ||
                    teardownController.signal.aborted
                  );
                }
                if (signalKey === 'reason') {
                  return teardownController.signal.aborted
                    ? teardownController.signal.reason
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
                    const listener = args[1] as unknown;
                    if (
                      args[0] !== 'abort' ||
                      (typeof listener !== 'function' &&
                        (typeof listener !== 'object' || listener === null))
                    ) {
                      Reflect.apply(addEventListener, userSignal, args);
                      teardownController.signal.addEventListener(...args);
                      return;
                    }
                    const invokeListener = function (
                      this: unknown,
                      ...eventArgs: unknown[]
                    ) {
                      if (typeof listener === 'function') {
                        return Reflect.apply(listener, this, eventArgs);
                      }
                      const handleEvent = Reflect.get(
                        listener,
                        'handleEvent',
                        listener,
                      );
                      return Reflect.apply(handleEvent, listener, eventArgs);
                    };
                    const wrappers = {
                      teardown: function (
                        this: unknown,
                        ...eventArgs: unknown[]
                      ) {
                        abortSource ??= 'teardown';
                        return Reflect.apply(invokeListener, this, eventArgs);
                      },
                      user: function (this: unknown, ...eventArgs: unknown[]) {
                        abortSource ??= 'user';
                        return Reflect.apply(invokeListener, this, eventArgs);
                      },
                    };
                    abortListenerWrappers.set(listener, wrappers);
                    const userArgs = [...args];
                    userArgs[1] = wrappers.user;
                    Reflect.apply(addEventListener, userSignal, userArgs);
                    const teardownArgs = [...args];
                    teardownArgs[1] = wrappers.teardown;
                    Reflect.apply(
                      teardownController.signal.addEventListener,
                      teardownController.signal,
                      teardownArgs,
                    );
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
                    const listener = args[1] as unknown;
                    const wrappers =
                      typeof listener === 'function' ||
                      (typeof listener === 'object' && listener !== null)
                        ? abortListenerWrappers.get(listener)
                        : undefined;
                    const userArgs = [...args];
                    const teardownArgs = [...args];
                    if (wrappers) {
                      userArgs[1] = wrappers.user;
                      teardownArgs[1] = wrappers.teardown;
                      abortListenerWrappers.delete(listener as object);
                    }
                    try {
                      Reflect.apply(removeEventListener, userSignal, userArgs);
                    } finally {
                      Reflect.apply(
                        teardownController.signal.removeEventListener,
                        teardownController.signal,
                        teardownArgs,
                      );
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
      const teardownAbortReason = Symbol('Rstest environment teardown');
      const trackedPromise = new Promise<T>((resolve, reject) => {
        void nativePromise.then(
          (result) => {
            timerCancellations.delete(trackedPromise);
            resolve(result);
          },
          (error) => {
            timerCancellations.delete(trackedPromise);
            let causedByTeardown = false;
            try {
              causedByTeardown =
                abortSource === 'teardown' ||
                (typeof error === 'object' &&
                  error !== null &&
                  Reflect.get(error, 'cause') === teardownAbortReason);
            } catch {
              // Preserve the original rejection if inspecting it is unsafe.
            }
            if (!causedByTeardown) {
              reject(error);
            }
          },
        );
      });
      timerCancellations.set(trackedPromise, () => {
        // Internal cancellation must not reject user-created promise chains
        // after their test environment has already been destroyed.
        teardownController.abort(teardownAbortReason);
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
    const nodeTimer = resolveTrackedNodeTimer(timer);
    if (nodeTimer !== undefined) {
      trackedTimerLifecycleByHandle.get(nodeTimer)?.forget();
    }
    if (
      nodeTimer === undefined &&
      (typeof timer === 'number' ||
        (typeof timer === 'string' && Number.isFinite(Number(timer))))
    ) {
      domTimers?.clearTimeout(timer as number);
    }
    nodeTimers.clearTimeout(timer);
  };
  const clearInterval = (
    timer: Parameters<NodeTimerPrimitives['clearInterval']>[0],
  ) => {
    const nodeTimer = resolveTrackedNodeTimer(timer);
    if (nodeTimer !== undefined) {
      trackedTimerLifecycleByHandle.get(nodeTimer)?.forget();
    }
    if (
      nodeTimer === undefined &&
      (typeof timer === 'number' ||
        (typeof timer === 'string' && Number.isFinite(Number(timer))))
    ) {
      domTimers?.clearInterval(timer as number);
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
  const pendingErrorCancellations = new WeakMap<
    Event,
    { preventedDuringDispatch: boolean }
  >();
  // DOM constructors are runtime Window properties, but lib.dom declares them on globalThis.
  const EventConstructor = Reflect.get(window, 'Event', window) as typeof Event;
  const eventPrototype = EventConstructor.prototype;
  const prototypePreventDefaultDescriptor = Object.getOwnPropertyDescriptor(
    eventPrototype,
    'preventDefault',
  );
  const prototypePreventDefault = eventPrototype.preventDefault;
  const trackedPrototypePreventDefault = function (this: Event) {
    const result = Reflect.apply(prototypePreventDefault, this, []);
    const cancellation = pendingErrorCancellations.get(this);
    if (cancellation && this.eventPhase !== 0) {
      cancellation.preventedDuringDispatch = this.defaultPrevented;
    }
    return result;
  };
  let restorePrototypePreventDefault = () => {};
  try {
    Object.defineProperty(eventPrototype, 'preventDefault', {
      configurable: prototypePreventDefaultDescriptor?.configurable ?? true,
      enumerable: prototypePreventDefaultDescriptor?.enumerable,
      value: trackedPrototypePreventDefault,
      writable: prototypePreventDefaultDescriptor?.writable ?? true,
    });
    restorePrototypePreventDefault = () => {
      if (eventPrototype.preventDefault === trackedPrototypePreventDefault) {
        if (prototypePreventDefaultDescriptor) {
          Object.defineProperty(
            eventPrototype,
            'preventDefault',
            prototypePreventDefaultDescriptor,
          );
        } else {
          Reflect.deleteProperty(eventPrototype, 'preventDefault');
        }
      }
    };
  } catch {
    // Fall back to tracking preventDefault directly on each error event.
  }
  const throwUnhandledError = (e: ErrorEvent) => {
    if (!trackedTimerErrorEvents.has(e)) {
      const error = e.error;
      const cancellation = {
        preventedDuringDispatch: e.defaultPrevented,
      };
      pendingErrorCancellations.set(e, cancellation);
      const preventDefaultDescriptor = Object.getOwnPropertyDescriptor(
        e,
        'preventDefault',
      );
      const preventDefault = e.preventDefault;
      const capturePreventDefault = function (
        this: ErrorEvent,
        ...args: unknown[]
      ) {
        const result = Reflect.apply(preventDefault, this, args);
        if (this === e && e.eventPhase !== 0) {
          cancellation.preventedDuringDispatch = e.defaultPrevented;
        }
        return result;
      };
      let restorePreventDefault = () => {};
      try {
        Object.defineProperty(e, 'preventDefault', {
          configurable: true,
          value: capturePreventDefault,
          writable: true,
        });
        restorePreventDefault = () => {
          const currentDescriptor = Object.getOwnPropertyDescriptor(
            e,
            'preventDefault',
          );
          if (currentDescriptor?.value !== capturePreventDefault) {
            return;
          }
          if (preventDefaultDescriptor) {
            Object.defineProperty(
              e,
              'preventDefault',
              preventDefaultDescriptor,
            );
          } else {
            Reflect.deleteProperty(e, 'preventDefault');
          }
        };
      } catch {
        // Preserve error reporting for Event implementations that cannot be patched.
      }
      reportUnhandledError(error, () => {
        restorePreventDefault();
        pendingErrorCancellations.delete(e);
        return cancellation.preventedDuringDispatch;
      });
    }
  };
  window.addEventListener('error', throwUnhandledError);
  return (): void => {
    window.removeEventListener('error', throwUnhandledError);
    restorePrototypePreventDefault();
  };
}
