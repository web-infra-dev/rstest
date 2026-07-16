import type { ConstructorOptions } from 'jsdom';
import type { TestEnvironment } from '../../../types';
import { checkPkgInstalled } from '../../util';
import {
  addDefaultErrorHandler,
  installGlobal,
  installTimerTracking,
  type NodeTimerPrimitives,
} from './utils';

type JSDOMOptions = ConstructorOptions & {
  html?: string | ArrayBufferLike;
  console?: boolean;
};

export const environment: TestEnvironment<typeof globalThis> = {
  name: 'jsdom',
  setup: async (global, options) => {
    checkPkgInstalled('jsdom');
    const { CookieJar, JSDOM, ResourceLoader, VirtualConsole } =
      await import('jsdom');
    const nodeTimers: NodeTimerPrimitives = {
      AbortController: global.AbortController,
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
