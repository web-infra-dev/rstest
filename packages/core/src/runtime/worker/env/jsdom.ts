import { Blob as NodeBlob } from 'node:buffer';
import { URL as NodeURL } from 'node:url';
import type { ConstructorOptions, DOMWindow } from 'jsdom';
import type { TestEnvironment } from '../../../types';
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

function installJSDOMObjectURL(window: DOMWindow): () => void {
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

  const cleanupObjectURLs = installObjectURLTracker(URLConstructor);
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

export const environment: TestEnvironment<typeof globalThis> = {
  name: 'jsdom',
  setup: async (global, options) => {
    checkPkgInstalled('jsdom');
    const { CookieJar, JSDOM, ResourceLoader, VirtualConsole } =
      await import('jsdom');
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
      beforeParse(window) {
        beforeParse?.(window);
        cleanupObjectURLs = installJSDOMObjectURL(window);
      },
    });

    const cleanupGlobal = installGlobal(global, dom.window, {
      additionalKeys: ['URL', 'URLSearchParams'],
    });
    const cleanupTimers = installTimerTracking(global, nodeTimers);

    const cleanupHandler = addDefaultErrorHandler(global as unknown as Window);

    return {
      teardown() {
        cleanupHandler();
        cleanupObjectURLs();
        cleanupTimers();
        dom.window.close();
        cleanupGlobal();
      },
    };
  },
};
