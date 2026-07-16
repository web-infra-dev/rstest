import type { ConstructorOptions, DOMWindow } from 'jsdom';
import type { TestEnvironment } from '../../../types';
import { checkPkgInstalled } from '../../util';
import { addDefaultErrorHandler, installGlobal } from './utils';

type JSDOMOptions = ConstructorOptions & {
  html?: string | ArrayBufferLike;
  console?: boolean;
};

type NodeTimers = Pick<
  typeof globalThis,
  'clearInterval' | 'clearTimeout' | 'setInterval' | 'setTimeout'
>;

const TIMER_KEYS = [
  'clearInterval',
  'clearTimeout',
  'setInterval',
  'setTimeout',
] as const;

function runWithNodeTimers<T>(
  global: typeof globalThis,
  nodeTimers: NodeTimers,
  action: () => T,
): T {
  const descriptors = new Map<keyof NodeTimers, PropertyDescriptor>();
  for (const key of TIMER_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(global, key);
    if (descriptor) {
      descriptors.set(key, descriptor);
    }
    Object.defineProperty(global, key, {
      configurable: true,
      value: nodeTimers[key],
      writable: true,
    });
  }

  try {
    return action();
  } finally {
    for (const key of TIMER_KEYS) {
      const descriptor = descriptors.get(key);
      if (descriptor) {
        Object.defineProperty(global, key, descriptor);
      } else {
        Reflect.deleteProperty(global, key);
      }
    }
  }
}

function installNodeFetchCompatibility(
  global: typeof globalThis,
  nodeTimers: NodeTimers,
): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(global, 'fetch');
  if (!descriptor || typeof descriptor.value !== 'function') {
    return () => {};
  }

  const nodeFetch = descriptor.value as typeof globalThis.fetch;
  Object.defineProperty(global, 'fetch', {
    ...descriptor,
    value: function (...args) {
      return runWithNodeTimers(global, nodeTimers, () =>
        Reflect.apply(nodeFetch, global, args),
      );
    } satisfies typeof globalThis.fetch,
  });

  return () => Object.defineProperty(global, 'fetch', descriptor);
}

function installWindowTimers(
  global: typeof globalThis,
  window: DOMWindow,
  runScripts: ConstructorOptions['runScripts'],
  nodeTimers: NodeTimers,
): void {
  const nodeSetTimeout = nodeTimers.setTimeout.bind(global);
  const nodeClearTimeout = nodeTimers.clearTimeout.bind(global);
  const nodeClearInterval = nodeTimers.clearInterval.bind(global);
  const activeTimers = new Map<number, () => void>();
  let nextTimerId = 1;

  const reportException = (error: unknown) => {
    const event = new window.ErrorEvent('error', {
      cancelable: true,
      error,
      filename: window.location.href,
      message: error instanceof Error ? error.message : String(error),
    });
    window.dispatchEvent(event);
  };

  const runHandler = (handler: TimerHandler, args: unknown[]) => {
    try {
      if (typeof handler === 'function') {
        handler.apply(global, args);
      } else if (runScripts === 'dangerously') {
        global.eval(String(handler));
      }
    } catch (error) {
      reportException(error);
    }
  };

  window.setTimeout = (handler, timeout = 0, ...args) => {
    const timerId = nextTimerId++;
    const timer = nodeSetTimeout(() => {
      activeTimers.delete(timerId);
      runHandler(handler, args);
    }, timeout);
    activeTimers.set(timerId, () => nodeClearTimeout(timer));
    return timerId;
  };
  window.setInterval = (handler, timeout = 0, ...args) => {
    const timerId = nextTimerId++;
    const schedule = () => {
      const timer = nodeSetTimeout(() => {
        if (!activeTimers.has(timerId)) {
          return;
        }
        runHandler(handler, args);
        if (activeTimers.has(timerId)) {
          schedule();
        }
      }, timeout);
      activeTimers.set(timerId, () => nodeClearTimeout(timer));
    };
    schedule();
    return timerId;
  };

  const clearTimer = (
    timerId: NodeJS.Timeout | number | undefined,
    clearNodeTimer: (timerId: NodeJS.Timeout | number | undefined) => void,
  ) => {
    const cancel = activeTimers.get(Number(timerId));
    if (cancel) {
      cancel();
      activeTimers.delete(Number(timerId));
    } else if (typeof timerId === 'object') {
      // jsdom can create native timers before beforeParse is called. Keep its
      // cleanup path working when it passes one of those handles back to us.
      clearNodeTimer(timerId);
    }
  };
  window.clearTimeout = (timerId) => clearTimer(timerId, nodeClearTimeout);
  window.clearInterval = (timerId) => clearTimer(timerId, nodeClearInterval);

  const close = window.close.bind(window);
  window.close = () => {
    for (const cancel of activeTimers.values()) {
      cancel();
    }
    activeTimers.clear();
    close();
  };
}

export const environment: TestEnvironment<typeof globalThis> = {
  name: 'jsdom',
  setup: async (global, options) => {
    checkPkgInstalled('jsdom');
    const { CookieJar, JSDOM, ResourceLoader, VirtualConsole } =
      await import('jsdom');
    const nodeTimers = Object.fromEntries(
      TIMER_KEYS.map((key) => [key, global[key]]),
    ) as NodeTimers;

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
      beforeParse,
      ...restOptions
    } = options as JSDOMOptions;
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
      beforeParse(window) {
        installWindowTimers(global, window, runScripts, nodeTimers);
        beforeParse?.(window);
      },
      ...restOptions,
    });

    const cleanupGlobal = installGlobal(global, dom.window, {
      // Node defines these globals, so installGlobal only replaces them when
      // explicitly requested.
      additionalKeys: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
      ],
    });
    // Node's built-in fetch expects its timer handles to expose methods such as
    // unref(). Temporarily restore Node timers while undici initializes a
    // request, while keeping browser-style timers visible to test code.
    const cleanupFetch = installNodeFetchCompatibility(global, nodeTimers);

    const cleanupHandler = addDefaultErrorHandler(global as unknown as Window);

    return {
      teardown() {
        cleanupHandler();
        dom.window.close();
        cleanupGlobal();
        cleanupFetch();
      },
    };
  },
};
