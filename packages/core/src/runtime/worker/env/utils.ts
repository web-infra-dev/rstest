import { KEYS } from './jsdomKeys';

export const SKIP_KEYS: string[] = ['window', 'self', 'top', 'parent'];

export function getWindowKeys(
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
  return name[0] === name[0]?.toUpperCase();
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

  const originals = new Map<string | symbol, any>();

  const overrides = new Map<string | symbol, any>();
  for (const key of keys) {
    const boundFunction =
      bindFunctions &&
      typeof win[key] === 'function' &&
      !isClassLike(key) &&
      win[key].bind(win);

    if (key in global) {
      originals.set(key, global[key]);
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

  const federationEnabled = Boolean((globalThis as any).__rstest_federation__);

  // Most environments expect `window`/`self` to map to the worker global.
  // Module Federation's Node runtime can evaluate code in a DOM window context
  // (e.g. via <script> in JSDOM), so point these to the real window only when
  // federation compatibility mode is enabled.
  global.window = federationEnabled ? win : global;
  global.self = federationEnabled ? win : global;
  global.top = federationEnabled ? win : global;
  global.parent = federationEnabled ? win : global;

  if (global.global) {
    global.global = global;
  }

  // rewrite defaultView to reference the same global context
  if (global.document?.defaultView) {
    Object.defineProperty(global.document, 'defaultView', {
      get: () => (federationEnabled ? win : global),
      enumerable: true,
      configurable: true,
    });
  }

  for (const k of SKIP_KEYS) {
    keys.add(k);
  }

  return () => {
    for (const key of keys) {
      delete global[key];
    }
    originals.forEach((v, k) => {
      global[k] = v;
    });
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
