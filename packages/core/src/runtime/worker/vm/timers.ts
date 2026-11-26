import { VM_TIMER_EXPORTS } from './timerExports';

const vmTimerExports = new Set<string>(VM_TIMER_EXPORTS);

export const createVmTimersLoader = (
  runtimeGlobal: Record<PropertyKey, unknown>,
): ((timersModule: Record<PropertyKey, unknown>) => unknown) => {
  let timersProxy: unknown;
  return (timersModule) => {
    const usesGlobalTimers = VM_TIMER_EXPORTS.some(
      (name) => timersModule[name] !== runtimeGlobal[name],
    );
    if (!usesGlobalTimers) {
      return timersModule;
    }
    timersProxy ??= new Proxy(timersModule, {
      get(target, property, receiver) {
        if (typeof property === 'string' && vmTimerExports.has(property)) {
          return runtimeGlobal[property];
        }
        return Reflect.get(target, property, receiver);
      },
    });
    return timersProxy;
  };
};

export const createVmTimersPromisesLoader = (
  runtimeGlobal: Record<PropertyKey, unknown>,
): ((timersModule: Record<PropertyKey, unknown>) => unknown) & {
  dispose: () => void;
} => {
  let timersProxy: unknown;
  let schedulerProxy: unknown;
  const wrappedMethods = new WeakMap<object, Map<PropertyKey, unknown>>();
  const pending = new Set<{ cancel: () => void }>();

  const createAbortError = (options?: ErrorOptions): Error => {
    const ErrorConstructor = runtimeGlobal.Error as
      (new (message?: string, options?: ErrorOptions) => Error) | undefined;
    const error = ErrorConstructor
      ? new ErrorConstructor('The operation was aborted', options)
      : new Error('The operation was aborted', options);
    error.name = 'AbortError';
    (error as Error & { code?: string }).code = 'ABORT_ERR';
    return error;
  };

  const isOptionsObject = (
    value: unknown,
  ): value is {
    ref?: boolean;
    signal?: AbortSignal;
  } => typeof value === 'object' && value !== null;

  const getOptionsIndex = (name: PropertyKey): number | undefined => {
    if (name === 'setTimeout') {
      return 2;
    }
    if (name === 'setImmediate' || name === 'wait') {
      return 1;
    }
    return undefined;
  };

  const createPromiseTimer = (
    method: (...args: unknown[]) => Promise<unknown>,
    target: Record<PropertyKey, unknown>,
    args: unknown[],
    optionsIndex: number | undefined,
  ): unknown => {
    const PromiseConstructor = runtimeGlobal.Promise as PromiseConstructor;
    const hasOptionsArgument =
      optionsIndex !== undefined && args.length > optionsIndex;
    const externalOptions =
      hasOptionsArgument && isOptionsObject(args[optionsIndex])
        ? args[optionsIndex]
        : undefined;
    const controller = new AbortController();
    const nativeArgs = [...args];
    if (optionsIndex !== undefined) {
      if (!hasOptionsArgument) {
        nativeArgs[optionsIndex] = { signal: controller.signal };
      } else if (externalOptions) {
        nativeArgs[optionsIndex] = {
          ...externalOptions,
          signal: controller.signal,
        };
      }
    }

    let settled = false;
    let removeSignalListener: (() => void) | undefined;
    let rejectPromise!: (reason: unknown) => void;
    const record = { cancel: () => cancel() };
    const settle = (callback: (value: unknown) => void, value: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      pending.delete(record);
      removeSignalListener?.();
      callback(value);
    };
    const cancel = (options?: ErrorOptions) => {
      controller.abort();
      settle(rejectPromise, createAbortError(options));
    };

    const promise = new PromiseConstructor((resolve, reject) => {
      rejectPromise = reject;
      const signal = externalOptions?.signal;
      if (signal?.aborted) {
        cancel({ cause: signal.reason });
        return;
      }
      if (signal) {
        const onAbort = () => {
          cancel({ cause: signal.reason });
        };
        signal.addEventListener('abort', onAbort, { once: true });
        removeSignalListener = () =>
          signal.removeEventListener('abort', onAbort);
      }
      pending.add(record);
      void Promise.resolve(Reflect.apply(method, target, nativeArgs)).then(
        (value) => settle(resolve, value),
        (error) => settle(reject, error),
      );
    });
    // Keep the returned promise rejectable for callers that explicitly await
    // it, while preventing teardown cancellation from becoming an unhandled
    // rejection when the caller intentionally discards the promise.
    void promise.catch(() => undefined);
    return promise;
  };

  const loadTimersPromises = ((timersModule) => {
    const wrapPromiseMethod = (
      target: Record<PropertyKey, unknown>,
      name: PropertyKey,
    ): unknown => {
      const method = target[name];
      if (typeof method !== 'function') {
        return method;
      }
      let methods = wrappedMethods.get(target);
      if (!methods) {
        methods = new Map();
        wrappedMethods.set(target, methods);
      }
      const cached = methods.get(name);
      if (cached) {
        return cached;
      }
      const wrapped = (...args: unknown[]) =>
        createPromiseTimer(
          method as (...args: unknown[]) => Promise<unknown>,
          target,
          args,
          getOptionsIndex(name),
        );
      methods.set(name, wrapped);
      return wrapped;
    };

    if (!timersProxy) {
      const scheduler = timersModule.scheduler;
      if (scheduler && typeof scheduler === 'object') {
        schedulerProxy = new Proxy(scheduler, {
          get(target, property, receiver) {
            if (property === 'wait' || property === 'yield') {
              return wrapPromiseMethod(
                target as Record<PropertyKey, unknown>,
                property,
              );
            }
            return Reflect.get(target, property, receiver);
          },
        });
      }
      timersProxy = new Proxy(timersModule, {
        get(target, property, receiver) {
          if (property === 'setTimeout' || property === 'setImmediate') {
            return wrapPromiseMethod(target, property);
          }
          if (property === 'scheduler' && schedulerProxy) {
            return schedulerProxy;
          }
          return Reflect.get(target, property, receiver);
        },
      });
    }
    return timersProxy;
  }) as ((timersModule: Record<PropertyKey, unknown>) => unknown) & {
    dispose: () => void;
  };
  loadTimersPromises.dispose = () => {
    for (const timer of pending) {
      timer.cancel();
    }
    pending.clear();
  };
  return loadTimersPromises;
};
