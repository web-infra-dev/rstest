import { Blob as NodeBlob } from 'node:buffer';
import { URL as NodeURL } from 'node:url';
import { runInContext } from 'node:vm';
import type vm from 'node:vm';
import type { ConstructorOptions, DOMWindow } from 'jsdom';
import type {
  TestEnvironment,
  TestEnvironmentContext,
  TestEnvironmentReturn,
} from '../../../types';
import { checkPkgInstalled } from '../../util';
import {
  addDefaultErrorHandler,
  installGlobal,
  installObjectURLTracker,
  installTimerTracking,
  type NodeTimerPrimitives,
} from './utils';

type JSDOMOptions = ConstructorOptions & {
  html?: string | ArrayBufferLike;
  console?: boolean;
};

type JSDOMBlobImpl = {
  _buffer?: Uint8Array;
  _bytes?: Uint8Array;
};

type VirtualConsoleForwarder =
  | {
      forwardTo(console: Console): unknown;
    }
  | {
      sendTo(console: Console): unknown;
    };

export const forwardVirtualConsole = (
  virtualConsole: VirtualConsoleForwarder,
  console: Console,
): void => {
  if ('forwardTo' in virtualConsole) {
    virtualConsole.forwardTo(console);
  } else {
    virtualConsole.sendTo(console);
  }
};

const createDeferredConsole = (): {
  console: Console;
  setTarget: (target: Console) => void;
} => {
  let target: Console | undefined;
  const pending: { method: PropertyKey; args: unknown[] }[] = [];
  const methods = Object.fromEntries(
    Object.keys(globalThis.console).map((method) => [method, undefined]),
  );
  const deferred = new Proxy(methods, {
    get:
      (_target, method: PropertyKey) =>
      (...args: unknown[]) => {
        if (target) {
          const fn = Reflect.get(target, method);
          if (typeof fn === 'function') {
            Reflect.apply(fn, target, args);
          }
          return;
        }
        pending.push({ method, args });
      },
  }) as unknown as Console;

  return {
    console: deferred,
    setTarget(nextTarget) {
      target = nextTarget;
      for (const { args, method } of pending.splice(0)) {
        const fn = Reflect.get(target, method);
        if (typeof fn === 'function') {
          Reflect.apply(fn, target, args);
        }
      }
    },
  };
};

function patchAddEventListener(
  window: DOMWindow,
  NodeAbortSignal: typeof AbortSignal,
): () => void {
  const abortBridges = new WeakMap<
    AbortSignal,
    { controller: AbortController; forwardingSignal: AbortSignal }
  >();
  const JSDOMAbortController = window.AbortController;
  const eventTargetPrototype = window.EventTarget.prototype;
  const originalAddEventListener = eventTargetPrototype.addEventListener;

  const getCompatibleSignal = (signal: unknown): unknown => {
    if (
      typeof signal !== 'object' ||
      signal === null ||
      !Object.prototype.isPrototypeOf.call(NodeAbortSignal.prototype, signal)
    ) {
      return signal;
    }

    const nodeSignal = signal as AbortSignal;
    let bridge = abortBridges.get(nodeSignal);
    if (!bridge) {
      const controller = new JSDOMAbortController();
      const forwardingSignal = NodeAbortSignal.any([nodeSignal]);
      if (forwardingSignal.aborted) {
        controller.abort(forwardingSignal.reason);
      } else {
        forwardingSignal.addEventListener(
          'abort',
          () => controller.abort(forwardingSignal.reason),
          { once: true },
        );
      }
      bridge = { controller, forwardingSignal };
      abortBridges.set(nodeSignal, bridge);
    }
    return bridge.controller.signal;
  };

  eventTargetPrototype.addEventListener = function addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    const optionsValue = options as unknown;
    if (
      optionsValue !== null &&
      (typeof optionsValue === 'object' || typeof optionsValue === 'function')
    ) {
      const listenerOptions = optionsValue as object;
      const read = (key: keyof AddEventListenerOptions) =>
        Reflect.get(listenerOptions, key, listenerOptions);

      return originalAddEventListener.call(this, type, callback, {
        get capture() {
          return read('capture');
        },
        get once() {
          return read('once');
        },
        get passive() {
          return read('passive');
        },
        get signal() {
          return getCompatibleSignal(read('signal')) as AbortSignal | undefined;
        },
      });
    }

    return originalAddEventListener.call(this, type, callback, options);
  };

  return () => {
    eventTargetPrototype.addEventListener = originalAddEventListener;
  };
}

type JSDOMModule = typeof import('jsdom');

const loadJSDOM = async (dependency?: JSDOMModule): Promise<JSDOMModule> => {
  if (!dependency) {
    checkPkgInstalled('jsdom');
  }
  return dependency ?? import('jsdom');
};

const createJSDOM = (
  dependency: JSDOMModule,
  options: Record<string, any>,
  context: TestEnvironmentContext,
  enableVirtualConsole: boolean,
  virtualConsoleTarget?: Console,
) => {
  const { CookieJar, JSDOM, ResourceLoader, VirtualConsole } = dependency;
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
  let cleanupObjectURLs = () => {};
  const virtualConsole =
    console && enableVirtualConsole ? new VirtualConsole() : undefined;
  const deferredConsole =
    virtualConsole && !virtualConsoleTarget
      ? createDeferredConsole()
      : undefined;
  if (virtualConsole) {
    forwardVirtualConsole(
      virtualConsole,
      virtualConsoleTarget ?? deferredConsole!.console,
    );
  }
  const dom = new JSDOM(html, {
    pretendToBeVisual,
    resources:
      resources ?? (userAgent ? new ResourceLoader({ userAgent }) : undefined),
    runScripts,
    url,
    virtualConsole,
    cookieJar: cookieJar ? new CookieJar() : undefined,
    includeNodeLocations,
    contentType,
    userAgent,
    ...restOptions,
    beforeParse(window) {
      beforeParse?.(window);
      cleanupObjectURLs = installJSDOMObjectURL(window, context);
    },
  });

  return {
    cleanupObjectURLs: () => cleanupObjectURLs(),
    dom,
    setVirtualConsoleTarget: (target: Console) =>
      deferredConsole?.setTarget(target),
    virtualConsole,
  };
};

function installJSDOMObjectURL(
  window: DOMWindow,
  context: TestEnvironmentContext,
): () => void {
  const implSymbol = Object.getOwnPropertySymbols(new window.Blob())[0]!;
  const URLConstructor = window.URL as typeof URL;
  const createDescriptor = Object.getOwnPropertyDescriptor(
    URLConstructor,
    'createObjectURL',
  );
  const revokeDescriptor = Object.getOwnPropertyDescriptor(
    URLConstructor,
    'revokeObjectURL',
  );

  if (typeof URLConstructor.createObjectURL !== 'function') {
    Object.defineProperty(URLConstructor, 'createObjectURL', {
      value(blob: NodeBlob | Blob | MediaSource): string {
        // The private Symbol(impl) is shared by Blob wrappers from other jsdom
        // realms, unlike their constructors.
        const impl = (blob as unknown as Record<symbol, JSDOMBlobImpl>)[
          implSymbol
        ];
        const bytes = impl?._buffer ?? impl?._bytes;
        if (bytes) {
          return NodeURL.createObjectURL(
            new NodeBlob([bytes], { type: (blob as Blob).type }),
          );
        }
        return NodeURL.createObjectURL(blob as NodeBlob);
      },
      configurable: true,
      writable: true,
    });
  }
  if (typeof URLConstructor.revokeObjectURL !== 'function') {
    Object.defineProperty(URLConstructor, 'revokeObjectURL', {
      value(url: string): void {
        NodeURL.revokeObjectURL(url);
      },
      configurable: true,
      writable: true,
    });
  }

  // The polyfill above is behavior and always installs, unlike the tracker
  // below, which only feeds environment teardown.
  const cleanupObjectURLs = installObjectURLTracker(URLConstructor, context);
  return () => {
    cleanupObjectURLs();
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

export const setupEnvironment = async (
  global: typeof globalThis,
  options: Record<string, any>,
  context: TestEnvironmentContext,
  dependency?: JSDOMModule,
): Promise<TestEnvironmentReturn> => {
  const jsdom = await loadJSDOM(dependency);
  const nodeTimers: NodeTimerPrimitives = {
    clearInterval: global.clearInterval ?? globalThis.clearInterval,
    clearTimeout: global.clearTimeout ?? globalThis.clearTimeout,
    setInterval: global.setInterval ?? globalThis.setInterval,
    setTimeout: global.setTimeout ?? globalThis.setTimeout,
  };

  const { cleanupObjectURLs, dom } = createJSDOM(
    jsdom,
    options,
    context,
    global.console !== undefined,
    global.console,
  );
  const cleanupAddEventListener = patchAddEventListener(
    dom.window,
    global.AbortSignal,
  );

  const cleanupGlobal = installGlobal(global, dom.window, {
    additionalKeys: ['URL', 'URLSearchParams'],
  });
  const cleanupTimers = installTimerTracking(global, nodeTimers, context);

  const cleanupHandler = addDefaultErrorHandler(global as unknown as Window);

  return {
    teardown() {
      cleanupHandler();
      cleanupAddEventListener();
      cleanupObjectURLs();
      cleanupTimers();
      dom.window.close();
      cleanupGlobal();
    },
  };
};

export const setupVM = async (
  options: Record<string, any>,
  context: TestEnvironmentContext,
  dependency?: JSDOMModule,
): Promise<{
  context: vm.Context;
  setVirtualConsoleTarget: (target: Console) => void;
  teardown: () => void;
}> => {
  const jsdom = await loadJSDOM(dependency);
  const { cleanupObjectURLs, dom, setVirtualConsoleTarget, virtualConsole } =
    createJSDOM(jsdom, options, context, true);
  const vmContext = dom.getInternalVMContext();
  const nodeTimers: NodeTimerPrimitives = {
    clearInterval: globalThis.clearInterval,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    setTimeout: globalThis.setTimeout,
  };
  const vmGlobal = runInContext('globalThis', vmContext) as typeof globalThis;
  const cleanupAddEventListener = patchAddEventListener(
    dom.window,
    globalThis.AbortSignal,
  );
  const cleanupTimers = installTimerTracking(vmGlobal, nodeTimers, context);
  const cleanupHandler = addDefaultErrorHandler(vmGlobal as unknown as Window);

  return {
    context: vmContext,
    setVirtualConsoleTarget: (target) => {
      if (virtualConsole) {
        setVirtualConsoleTarget(target);
      }
    },
    teardown() {
      cleanupHandler();
      cleanupAddEventListener();
      cleanupObjectURLs();
      cleanupTimers();
      dom.window.close();
    },
  };
};

export const environment: TestEnvironment<typeof globalThis> = {
  name: 'jsdom',
  setup: setupEnvironment,
};
