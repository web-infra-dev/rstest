import { promisify } from 'node:util';
import { KEYS } from './jsdomKeys';

export type NodeTimerPrimitives = Pick<
  typeof globalThis,
  'clearInterval' | 'clearTimeout' | 'setInterval' | 'setTimeout'
>;

const TIMER_KEYS = ['setInterval', 'setTimeout'] as const;

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

/**
 * Keep Node timer handles scoped to one DOM environment so pending timers do
 * not keep a worker alive after that environment has been torn down.
 */
export function installTimerTracking(
  global: typeof globalThis,
  nodeTimers: NodeTimerPrimitives,
): () => void {
  const timers = new Map<NodeJS.Timeout, (timer: NodeJS.Timeout) => void>();
  const descriptors = new Map<
    (typeof TIMER_KEYS)[number],
    PropertyDescriptor
  >();
  let active = true;

  const track = (
    timer: NodeJS.Timeout,
    clearTimer: (timer: NodeJS.Timeout) => void,
  ): NodeJS.Timeout => {
    if (active) {
      timers.set(timer, clearTimer);
    }
    return timer;
  };

  const setTimeout = ((...args: unknown[]) =>
    track(
      Reflect.apply(nodeTimers.setTimeout, global, args) as NodeJS.Timeout,
      nodeTimers.clearTimeout,
    )) as NodeTimerPrimitives['setTimeout'];
  const setInterval = ((...args: unknown[]) =>
    track(
      Reflect.apply(nodeTimers.setInterval, global, args) as NodeJS.Timeout,
      nodeTimers.clearInterval,
    )) as NodeTimerPrimitives['setInterval'];

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

  const trackedTimers = {
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
    active = false;
    for (const [timer, clearTimer] of timers) {
      clearTimer(timer);
    }
    timers.clear();

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
