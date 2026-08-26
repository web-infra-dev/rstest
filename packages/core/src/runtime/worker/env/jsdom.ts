import { Blob as NodeBlob } from 'node:buffer';
import { URL as NodeURL } from 'node:url';
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

function patchAddEventListener(rootWindow: DOMWindow): () => void {
  const patchedWindows = new WeakSet<DOMWindow>();
  const cleanups: Array<() => void> = [];

  const patchWindow = (window: DOMWindow): void => {
    if (patchedWindows.has(window)) {
      return;
    }
    patchedWindows.add(window);

    const abortControllers = new WeakMap<AbortSignal, AbortController>();
    const signalForwarders = new Map<AbortSignal, EventListener>();
    const JSDOMAbortSignal = window.AbortSignal;
    const JSDOMAbortController = window.AbortController;
    const eventTargetPrototype = window.EventTarget.prototype;
    const originalAddEventListener = eventTargetPrototype.addEventListener;

    eventTargetPrototype.addEventListener = function addEventListener(
      type: string,
      callback: EventListenerOrEventListenerObject | null,
      options?: AddEventListenerOptions | boolean,
    ): void {
      if (typeof options === 'object' && options?.signal != null) {
        const { signal, ...otherOptions } = options;
        if (
          !Object.prototype.isPrototypeOf.call(
            JSDOMAbortSignal.prototype,
            signal,
          )
        ) {
          let jsdomAbortController = abortControllers.get(signal);
          if (!jsdomAbortController) {
            const controller = new JSDOMAbortController();
            if (signal.aborted) {
              controller.abort(signal.reason);
            } else {
              const forwardAbort = () => {
                signalForwarders.delete(signal);
                controller.abort(signal.reason);
              };
              signal.addEventListener('abort', forwardAbort, { once: true });
              signalForwarders.set(signal, forwardAbort);
            }
            jsdomAbortController = controller;
            abortControllers.set(signal, jsdomAbortController);
          }

          return originalAddEventListener.call(this, type, callback, {
            ...otherOptions,
            signal: jsdomAbortController.signal,
          });
        }
      }

      return originalAddEventListener.call(this, type, callback, options);
    };

    // Each iframe has its own jsdom EventTarget and AbortSignal realm. Patch a
    // child realm before exposing its window or document to test code.
    const iframePrototype = window.HTMLIFrameElement.prototype;
    const contentWindowDescriptor = Object.getOwnPropertyDescriptor(
      iframePrototype,
      'contentWindow',
    )!;
    const contentDocumentDescriptor = Object.getOwnPropertyDescriptor(
      iframePrototype,
      'contentDocument',
    )!;

    Object.defineProperty(iframePrototype, 'contentWindow', {
      ...contentWindowDescriptor,
      get(this: HTMLIFrameElement) {
        const childWindow: DOMWindow | null =
          contentWindowDescriptor.get!.call(this);
        if (childWindow) {
          patchWindow(childWindow);
        }
        return childWindow;
      },
    });
    Object.defineProperty(iframePrototype, 'contentDocument', {
      ...contentDocumentDescriptor,
      get(this: HTMLIFrameElement) {
        const childDocument: Document | null =
          contentDocumentDescriptor.get!.call(this);
        if (childDocument) {
          const childWindow: DOMWindow | null =
            contentWindowDescriptor.get!.call(this);
          if (childWindow) {
            patchWindow(childWindow);
          }
        }
        return childDocument;
      },
    });

    cleanups.push(() => {
      for (const [signal, forwardAbort] of signalForwarders) {
        signal.removeEventListener('abort', forwardAbort);
      }
      signalForwarders.clear();
      eventTargetPrototype.addEventListener = originalAddEventListener;
      Object.defineProperty(
        iframePrototype,
        'contentWindow',
        contentWindowDescriptor,
      );
      Object.defineProperty(
        iframePrototype,
        'contentDocument',
        contentDocumentDescriptor,
      );
    });
  };

  patchWindow(rootWindow);

  return () => {
    for (const cleanup of cleanups.reverse()) {
      cleanup();
    }
  };
}

type JSDOMModule = typeof import('jsdom');

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
  if (!dependency) {
    checkPkgInstalled('jsdom');
  }
  const { CookieJar, JSDOM, ResourceLoader, VirtualConsole } =
    dependency ?? (await import('jsdom'));
  const nodeTimers: NodeTimerPrimitives = {
    clearInterval: global.clearInterval ?? globalThis.clearInterval,
    clearTimeout: global.clearTimeout ?? globalThis.clearTimeout,
    setInterval: global.setInterval ?? globalThis.setInterval,
    setTimeout: global.setTimeout ?? globalThis.setTimeout,
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
    beforeParse,
    ...restOptions
  } = options as JSDOMOptions;
  let cleanupObjectURLs = () => {};
  const virtualConsole =
    console && global.console ? new VirtualConsole() : undefined;
  if (virtualConsole && global.console) {
    forwardVirtualConsole(virtualConsole, global.console);
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

  const cleanupAddEventListener = patchAddEventListener(dom.window);
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

export const environment: TestEnvironment<typeof globalThis> = {
  name: 'jsdom',
  setup: setupEnvironment,
};
