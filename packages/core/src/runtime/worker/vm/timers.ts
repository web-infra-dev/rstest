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
): ((timersModule: Record<PropertyKey, unknown>) => unknown) => {
  let timersProxy: unknown;
  let schedulerProxy: unknown;
  const wrappedMethods = new WeakMap<object, Map<PropertyKey, unknown>>();

  return (timersModule) => {
    const PromiseConstructor = runtimeGlobal.Promise as PromiseConstructor;
    const promiseResolve = PromiseConstructor.resolve.bind(PromiseConstructor);
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
        promiseResolve(Reflect.apply(method, target, args));
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
  };
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
