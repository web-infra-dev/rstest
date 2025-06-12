import type { ConstructorOptions } from 'jsdom';
import type { TestEnvironment } from '../../../types';
import { SKIP_KEYS, getWindowKeys } from './jsdomKeys';

type JSDOMOptions = ConstructorOptions & {
  html?: string | ArrayBufferLike;
  console?: boolean;
};

function installGlobal(
  global: any,
  win: any,
  options: {
    additionalKeys?: string[];
  } = {},
): () => void {
  const keys = getWindowKeys(global, win, options.additionalKeys);
  const isClassLike = (name: string) => {
    return name[0] === name[0]?.toUpperCase();
  };

  const originals = new Map<string | symbol, any>();

  const overrides = new Map<string | symbol, any>();
  for (const key of keys) {
    const boundFunction =
      typeof win[key] === 'function' && !isClassLike(key)
        ? win[key].bind(win)
        : undefined;

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
      delete global[key];
    }
    originals.forEach((v, k) => {
      global[k] = v;
    });
  };
}

function addDefaultErrorHandler(window: Window) {
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
  return () => {
    window.removeEventListener('error', throwUnhandledError);
  };
}

export default (<TestEnvironment>{
  name: 'jsdom',
  async setup(global: any, { jsdom = {} }) {
    const { CookieJar, JSDOM, ResourceLoader, VirtualConsole } = await import(
      'jsdom'
    );
    const {
      html = '<!DOCTYPE html>',
      userAgent,
      url = 'http://localhost:3000',
      contentType = 'text/html',
      pretendToBeVisual = true,
      includeNodeLocations = false,
      runScripts = 'dangerously',
      resources,
      console = false,
      cookieJar = false,
      ...restOptions
    } = jsdom as JSDOMOptions;
    const dom = new JSDOM(html, {
      pretendToBeVisual,
      resources:
        resources ??
        (userAgent ? new ResourceLoader({ userAgent }) : undefined),
      runScripts,
      url,
      virtualConsole:
        console && global.console
          ? new VirtualConsole().sendTo(global.console)
          : undefined,
      cookieJar: cookieJar ? new CookieJar() : undefined,
      includeNodeLocations,
      contentType,
      userAgent,
      ...restOptions,
    });

    const cleanupGlobal = installGlobal(global, dom.window);

    const cleanupHandler = addDefaultErrorHandler(global);

    global.jsdom = dom;

    return {
      teardown() {
        cleanupHandler();
        dom.window.close();
        delete global.jsdom;
        cleanupGlobal();
      },
    };
  },
});
