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
  const boundFunctionCache = new WeakMap<Function, Function>();

  const overrides = new Map<string | symbol, any>();
  for (const key of keys) {
    if (key in global) {
      originals.set(key, global[key]);
    }

    Object.defineProperty(global, key, {
      get() {
        if (overrides.has(key)) {
          return overrides.get(key);
        }
        const current = win[key];
        if (
          bindFunctions &&
          typeof current === 'function' &&
          !isClassLike(key)
        ) {
          const cached = boundFunctionCache.get(current);
          if (cached) {
            return cached;
          }
          const bound = current.bind(win);
          boundFunctionCache.set(current, bound);
          return bound;
        }
        return current;
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

  const addEventListener = window.addEventListener.bind(window);
  const removeEventListener = window.removeEventListener.bind(window);
  let internalListenerOp = false;

  window.addEventListener = function (...args: [any, any, any]) {
    if (args[0] === 'error' && !internalListenerOp) {
      userErrorListenerCount++;
    }
    return addEventListener.apply(this, args);
  };
  window.removeEventListener = function (...args: [any, any, any]) {
    if (args[0] === 'error' && userErrorListenerCount && !internalListenerOp) {
      userErrorListenerCount--;
    }
    return removeEventListener.apply(this, args);
  };

  const throwUnhandledError = (e: ErrorEvent) => {
    // Error listeners may call `event.preventDefault()` to indicate they handled
    // the error. Depending on the environment, our listener can run before user
    // listeners, so defer the decision to a microtask to observe `defaultPrevented`.
    const error = e.error;
    queueMicrotask(() => {
      // In some environments (e.g. happy-dom), `ErrorEvent` may not implement
      // `defaultPrevented` correctly. As a best-effort fallback, respect the
      // legacy `returnValue === false` convention (settable by user listeners).
      if ((e as any).defaultPrevented || (e as any).returnValue === false) {
        return;
      }
      if (userErrorListenerCount === 0 && error != null) {
        process.emit('uncaughtException', error);
      }
    });
  };

  // Register the default handler after patching `addEventListener`, but do not
  // count it as a user-provided error handler.
  internalListenerOp = true;
  window.addEventListener('error', throwUnhandledError);
  internalListenerOp = false;

  return (): void => {
    internalListenerOp = true;
    window.removeEventListener('error', throwUnhandledError);
    internalListenerOp = false;
    window.addEventListener = addEventListener as any;
    window.removeEventListener = removeEventListener as any;
  };
}
