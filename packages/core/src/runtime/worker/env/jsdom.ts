import type { ConstructorOptions } from 'jsdom';
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

function installTimerTracking(
  global: typeof globalThis,
  nodeTimers: NodeTimers,
): () => void {
  const timerCancellations = new Map<unknown, () => void>();
  const descriptors = new Map<keyof NodeTimers, PropertyDescriptor>();

  const runTimerCallback = <TArgs extends unknown[]>(
    callback: (...args: TArgs) => void,
    receiver: unknown,
    args: TArgs,
  ) => {
    try {
      Reflect.apply(callback, receiver, args);
    } catch (error) {
      global.dispatchEvent(
        new global.ErrorEvent('error', {
          cancelable: true,
          error,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  const setTimeout = <TArgs extends unknown[]>(
    callback: (...args: TArgs) => void,
    delay?: number,
    ...args: TArgs
  ) => {
    const timer = nodeTimers.setTimeout(
      function (this: unknown, ...callbackArgs) {
        runTimerCallback(callback, this, callbackArgs);
      },
      delay,
      ...args,
    );
    // A fired Node Timeout can be reactivated with refresh(), so keep its
    // handle tracked until it is explicitly cleared or the environment ends.
    timerCancellations.set(timer, () => nodeTimers.clearTimeout(timer));
    return timer;
  };
  const setInterval = <TArgs extends unknown[]>(
    callback: (...args: TArgs) => void,
    delay?: number,
    ...args: TArgs
  ) => {
    const timer = nodeTimers.setInterval(
      function (this: unknown, ...callbackArgs) {
        runTimerCallback(callback, this, callbackArgs);
      },
      delay,
      ...args,
    );
    timerCancellations.set(timer, () => nodeTimers.clearInterval(timer));
    return timer;
  };
  const clearTimeout = (timer: Parameters<NodeTimers['clearTimeout']>[0]) => {
    timerCancellations.delete(timer);
    nodeTimers.clearTimeout(timer);
  };
  const clearInterval = (timer: Parameters<NodeTimers['clearInterval']>[0]) => {
    timerCancellations.delete(timer);
    nodeTimers.clearInterval(timer);
  };

  const trackedTimers = {
    clearInterval,
    clearTimeout,
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
    for (const cancel of timerCancellations.values()) {
      cancel();
    }
    timerCancellations.clear();
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

export const environment: TestEnvironment<typeof globalThis> = {
  name: 'jsdom',
  setup: async (global, options) => {
    checkPkgInstalled('jsdom');
    const { CookieJar, JSDOM, ResourceLoader, VirtualConsole } =
      await import('jsdom');
    const nodeTimers: NodeTimers = {
      clearInterval: global.clearInterval,
      clearTimeout: global.clearTimeout,
      setInterval: global.setInterval,
      setTimeout: global.setTimeout,
    };

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
      ...restOptions,
    });

    const cleanupGlobal = installGlobal(global, dom.window);
    const cleanupTimers = installTimerTracking(global, nodeTimers);

    const cleanupHandler = addDefaultErrorHandler(global as unknown as Window);

    return {
      teardown() {
        cleanupHandler();
        dom.window.close();
        cleanupTimers();
        cleanupGlobal();
      },
    };
  },
};
