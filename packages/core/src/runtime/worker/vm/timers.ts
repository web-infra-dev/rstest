export const VM_TIMER_EXPORTS = [
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
] as const;

export const VM_PROMISE_TIMER_EXPORTS = [
  'setTimeout',
  'setImmediate',
  'scheduler',
] as const;

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

  const createAbortError = (): Error => {
    const ErrorConstructor = runtimeGlobal.Error as
      (new (message?: string) => Error) | undefined;
    const error = ErrorConstructor
      ? new ErrorConstructor('The operation was aborted')
      : new Error('The operation was aborted');
    error.name = 'AbortError';
    (error as Error & { code?: string }).code = 'ABORT_ERR';
    return error;
  };

  const isOptions = (
    value: unknown,
  ): value is {
    ref?: boolean;
    signal?: AbortSignal;
  } =>
    typeof value === 'object' &&
    value !== null &&
    ('ref' in value || 'signal' in value);

  const createPromiseTimer = (
    method: (...args: unknown[]) => Promise<unknown>,
    target: Record<PropertyKey, unknown>,
    args: unknown[],
  ): unknown => {
    const PromiseConstructor = runtimeGlobal.Promise as PromiseConstructor;
    const lastArg = args.at(-1);
    const externalOptions = isOptions(lastArg) ? lastArg : undefined;
    const controller = new AbortController();
    const options = {
      ...externalOptions,
      signal: controller.signal,
    };
    const nativeArgs = externalOptions
      ? [...args.slice(0, -1), options]
      : [...args, options];

    let settled = false;
    let removeSignalListener: (() => void) | undefined;
    let rejectPromise!: (reason: unknown) => void;
    let cancel = (): void => {};
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
    cancel = () => {
      controller.abort();
      settle(rejectPromise, createAbortError());
    };

    const promise = new PromiseConstructor((resolve, reject) => {
      rejectPromise = reject;
      const signal = externalOptions?.signal;
      if (signal?.aborted) {
        cancel();
        return;
      }
      if (signal) {
        const onAbort = () => {
          cancel();
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

export const createVmTimersShim =
  (): string => `const __rstest_timer_exports = new Set(${JSON.stringify(VM_TIMER_EXPORTS)});
let __rstest_timers_proxy;
const __rstest_load_timers = (id) => {
  const timers = __rstest_native_require(id);
  // This source is emitted as an Rspack banner, where bracket placeholders
  // such as "[name]" are expanded using the chunk name.
  const usesGlobalTimers = [...__rstest_timer_exports].some(
    (name) => Reflect.get(timers, name) !== Reflect.get(globalThis, name),
  );
  if (!usesGlobalTimers) return timers;
  if (!__rstest_timers_proxy) {
    __rstest_timers_proxy = new Proxy(timers, {
      get(target, property, receiver) {
        if (typeof property === 'string' && __rstest_timer_exports.has(property)) {
          return globalThis[property];
        }
        return Reflect.get(target, property, receiver);
      },
    });
  }
  return __rstest_timers_proxy;
};`;
