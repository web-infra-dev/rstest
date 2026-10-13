import { runInContext, type Context } from 'node:vm';

export type VmRuntimeGlobal = typeof globalThis & Record<string, unknown>;

const createVmFunction = <T>(
  vmContext: Context,
  source: string,
  hostFunction: T,
): T => {
  const createFunction = runInContext(source, vmContext) as (value: T) => T;
  return createFunction(hostFunction);
};

export const installWorkerHTMLElement = (
  runtimeGlobal: VmRuntimeGlobal,
): (() => void) => {
  // Chai/Loupe runs in the worker realm and identifies DOM nodes through its
  // global HTMLElement. Release the constructor at file teardown so a reused
  // worker cannot retain the disposed VM DOM.
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    get: () => runtimeGlobal.HTMLElement,
  });
  return () => {
    if (descriptor) {
      Object.defineProperty(globalThis, 'HTMLElement', descriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'HTMLElement');
    }
  };
};

export const installVmNodeGlobals = (
  runtimeGlobal: VmRuntimeGlobal,
  vmContext: Context,
): void => {
  const excluded = new Set([
    'GLOBAL',
    'root',
    'global',
    'globalThis',
    'fetch',
    'structuredClone',
  ]);
  for (const key of Object.getOwnPropertyNames(globalThis)) {
    if (excluded.has(key) || key in runtimeGlobal) {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    if (descriptor) {
      if ('get' in descriptor || 'set' in descriptor) {
        const { get, set } = descriptor;
        let assigned = false;
        let localValue: unknown;
        Object.defineProperty(runtimeGlobal, key, {
          ...descriptor,
          // Node accessors can require the host global as their receiver.
          get: get
            ? () => (assigned ? localValue : get.call(globalThis))
            : undefined,
          // Never invoke a host setter: replacements belong to this file only.
          set: set
            ? (value: unknown) => {
                assigned = true;
                localValue = value;
              }
            : undefined,
        });
      } else {
        Object.defineProperty(runtimeGlobal, key, descriptor);
      }
    }
  }

  if (!('fetch' in runtimeGlobal) && typeof globalThis.fetch === 'function') {
    Reflect.set(
      runtimeGlobal,
      'fetch',
      createVmFunction(
        vmContext,
        `(hostFetch) => async (...args) => {
          try {
            return await hostFetch(...args);
          } catch (error) {
            if (
              error === null ||
              (typeof error !== 'object' && typeof error !== 'function') ||
              Object.prototype.toString.call(error) !== '[object Error]'
            ) {
              throw error;
            }
            const constructor =
              typeof error.name === 'string'
                ? globalThis[error.name]
                : undefined;
            const ErrorConstructor =
              typeof constructor === 'function' &&
              (constructor === Error || constructor.prototype instanceof Error)
                ? constructor
                : Error;
            const wrapped = new ErrorConstructor(error.message);
            for (const key of Reflect.ownKeys(error)) {
              const descriptor = Object.getOwnPropertyDescriptor(error, key);
              if (descriptor) {
                Object.defineProperty(wrapped, key, descriptor);
              }
            }
            throw wrapped;
          }
        }`,
        globalThis.fetch,
      ),
    );
  }
  if (
    !('structuredClone' in runtimeGlobal) &&
    typeof globalThis.structuredClone === 'function'
  ) {
    Reflect.set(
      runtimeGlobal,
      'structuredClone',
      createVmFunction(
        vmContext,
        `(hostStructuredClone) => {
        const restoreValue = (value, seen) => {
          if (value === null || typeof value !== 'object' || seen.has(value)) {
            return value;
          }
          seen.add(value);

          const tag = Object.prototype.toString.call(value);
          if (tag === '[object Array]') {
            Object.setPrototypeOf(value, Array.prototype);
          } else if (tag === '[object Map]') {
            Object.setPrototypeOf(value, Map.prototype);
            for (const [key, entry] of value) {
              restoreValue(key, seen);
              restoreValue(entry, seen);
            }
          } else if (tag === '[object Set]') {
            Object.setPrototypeOf(value, Set.prototype);
            for (const entry of value) {
              restoreValue(entry, seen);
            }
          } else if (tag === '[object Date]') {
            Object.setPrototypeOf(value, Date.prototype);
          } else if (tag === '[object RegExp]') {
            Object.setPrototypeOf(value, RegExp.prototype);
          } else if (tag === '[object Error]') {
            const constructor = globalThis[value.name];
            Object.setPrototypeOf(
              value,
              typeof constructor === 'function' &&
                (constructor === Error || constructor.prototype instanceof Error)
                ? constructor.prototype
                : Error.prototype,
            );
          } else if (tag === '[object ArrayBuffer]') {
            Object.setPrototypeOf(value, ArrayBuffer.prototype);
          } else if (tag === '[object DataView]') {
            restoreValue(value.buffer, seen);
            Object.setPrototypeOf(value, DataView.prototype);
          } else {
            const constructorName = tag.slice(8, -1);
            const constructor = globalThis[constructorName];
            if (ArrayBuffer.isView(value)) {
              restoreValue(value.buffer, seen);
            }
            if (typeof constructor === 'function' && constructor.prototype) {
              Object.setPrototypeOf(value, constructor.prototype);
            } else {
              Object.setPrototypeOf(
                value,
                Object.getPrototypeOf(value) === null
                  ? null
                  : Object.prototype,
              );
            }
          }

          const keys =
            tag === '[object Error]' ? Reflect.ownKeys(value) : Object.keys(value);
          for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (descriptor && 'value' in descriptor) {
              restoreValue(descriptor.value, seen);
            }
          }
          return value;
        };

        return (value, options) =>
          restoreValue(hostStructuredClone(value, options), new WeakSet());
      }`,
        globalThis.structuredClone,
      ),
    );
  }

  Object.assign(runtimeGlobal, {
    process,
    Buffer,
    global: runtimeGlobal,
    setImmediate,
    clearImmediate,
  });
};
