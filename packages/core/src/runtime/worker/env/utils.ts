import { promisify } from 'node:util';
import type { TestEnvironmentContext } from '../../../types';
import { KEYS } from './jsdomKeys';

export type NodeTimerPrimitives = Pick<
  typeof globalThis,
  | 'clearImmediate'
  | 'clearInterval'
  | 'clearTimeout'
  | 'setImmediate'
  | 'setInterval'
  | 'setTimeout'
>;

const TIMER_KEYS = [
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
] as const;

type NodeTimerHandle = NodeJS.Immediate | NodeJS.Timeout;

const SKIP_KEYS: string[] = ['window', 'self', 'top', 'parent'];

function getWindowKeys(
  global: any,
  win: any,
  additionalKeys: string[] = [],
  preserveExistingKeys = false,
): Set<string> {
  const keysArray = [...additionalKeys, ...KEYS];

  return new Set(
    keysArray.concat(Object.getOwnPropertyNames(win)).filter((k) => {
      if (preserveExistingKeys && k in global) {
        return false;
      }
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

/**
 * Record the object URLs created through `URLConstructor` so the returned
 * cleanup can revoke the ones the test never revoked itself. Tracking only
 * feeds environment teardown, so a worker-scoped environment gets a no-op:
 * see `TestEnvironmentReturn.teardown`.
 */
export function installObjectURLTracker(
  URLConstructor: typeof URL,
  context: TestEnvironmentContext,
): () => void {
  if (context.scope === 'worker') {
    return () => {};
  }

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
    preserveExistingKeys?: boolean;
  } = {},
): () => void {
  const { bindFunctions = true, preserveExistingKeys = false } = options || {};
  const keys = getWindowKeys(
    global,
    win,
    options.additionalKeys,
    preserveExistingKeys,
  );

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

/**
 * Shadow the DOM timers `installGlobal` just exposed with Node's, so tests get
 * real `NodeJS.Timeout` handles. A file-scoped environment gets wrappers that
 * record every timeout, interval, and immediate created, so the returned
 * cleanup can clear the stragglers;
 * a worker-scoped one gets the Node primitives unwrapped — its teardown never
 * runs, so recording would retain every timer and its callback closure for the
 * worker's whole life (see `TestEnvironmentReturn.teardown`).
 */
export function installTimerTracking(
  global: typeof globalThis,
  nodeTimers: NodeTimerPrimitives,
  context: TestEnvironmentContext,
): () => void {
  const descriptors = new Map<
    (typeof TIMER_KEYS)[number],
    PropertyDescriptor
  >();

  const install = (
    timers: Pick<NodeTimerPrimitives, (typeof TIMER_KEYS)[number]>,
  ): void => {
    for (const key of TIMER_KEYS) {
      const descriptor = Object.getOwnPropertyDescriptor(global, key);
      if (descriptor) {
        descriptors.set(key, descriptor);
      }
      Object.defineProperty(global, key, {
        configurable: true,
        value: timers[key],
        writable: true,
      });
    }
  };

  const restore = (): void => {
    for (const key of TIMER_KEYS) {
      const descriptor = descriptors.get(key);
      if (descriptor) {
        Object.defineProperty(global, key, descriptor);
      } else {
        Reflect.deleteProperty(global, key);
      }
    }
  };

  if (context.scope === 'worker') {
    install(nodeTimers);
    return restore;
  }

  const pending = new Map<NodeTimerHandle, (timer: unknown) => void>();
  let active = true;

  const record = (
    timer: NodeTimerHandle,
    clearTimer: (timer: unknown) => void,
  ): NodeTimerHandle => {
    if (active) {
      pending.set(timer, clearTimer);
    }
    return timer;
  };

  const setTimeout = ((...args: unknown[]) =>
    record(
      Reflect.apply(nodeTimers.setTimeout, global, args) as NodeJS.Timeout,
      nodeTimers.clearTimeout as (timer: unknown) => void,
    )) as NodeTimerPrimitives['setTimeout'];
  const setInterval = ((...args: unknown[]) =>
    record(
      Reflect.apply(nodeTimers.setInterval, global, args) as NodeJS.Timeout,
      nodeTimers.clearInterval as (timer: unknown) => void,
    )) as NodeTimerPrimitives['setInterval'];
  const setImmediate = ((...args: unknown[]) =>
    record(
      Reflect.apply(nodeTimers.setImmediate, global, args) as NodeJS.Immediate,
      nodeTimers.clearImmediate as (timer: unknown) => void,
    )) as unknown as NodeTimerPrimitives['setImmediate'];

  const customPromisifyDescriptor = Object.getOwnPropertyDescriptor(
    nodeTimers.setTimeout,
    promisify.custom,
  );
  if (customPromisifyDescriptor) {
    Object.defineProperty(
      setTimeout,
      promisify.custom,
      customPromisifyDescriptor,
    );
  }

  install({
    clearImmediate: nodeTimers.clearImmediate,
    clearInterval: nodeTimers.clearInterval,
    clearTimeout: nodeTimers.clearTimeout,
    setImmediate,
    setInterval,
    setTimeout,
  });

  return () => {
    active = false;
    for (const [timer, clearTimer] of pending) {
      clearTimer(timer);
    }
    pending.clear();
    restore();
  };
}

export function addDefaultErrorHandler(window: Window) {
  let userErrorListenerCount = 0;
  const throwUnhandledError = (e: ErrorEvent) => {
    if (userErrorListenerCount === 0 && e.error != null) {
      process.emit('uncaughtException', e.error);
    }
  };
  const addEventListener = window.addEventListener.bind(window);
  const removeEventListener = window.removeEventListener.bind(window);
  window.addEventListener('error', throwUnhandledError);
  window.addEventListener = function (...args: [any, any, any]) {
    if (args[0] === 'error') {
      userErrorListenerCount++;
    }
    return addEventListener.apply(this, args);
  };
  window.removeEventListener = function (...args: [any, any, any]) {
    if (args[0] === 'error' && userErrorListenerCount) {
      userErrorListenerCount--;
    }
    return removeEventListener.apply(this, args);
  };
  return (): void => {
    window.removeEventListener('error', throwUnhandledError);
  };
}
