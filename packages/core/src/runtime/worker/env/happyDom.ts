import type { Window as HappyDOMWindow } from 'happy-dom';
import type { TestEnvironment } from '../../../types';
import { checkPkgInstalled } from '../../util';
import {
  addDefaultErrorHandler,
  installGlobal,
  installObjectURLTracker,
  installTimerTracking,
  type NodeTimerPrimitives,
} from './utils';

type HappyDOMOptions = ConstructorParameters<typeof HappyDOMWindow>[0];

export const environment: TestEnvironment<typeof globalThis, HappyDOMOptions> =
  {
    name: 'happy-dom',
    setup: async (global, options = {}) => {
      checkPkgInstalled('happy-dom');

      const { Window, GlobalWindow } = await import('happy-dom');
      const nodeTimers: NodeTimerPrimitives = {
        AbortController: global.AbortController,
        clearInterval: global.clearInterval,
        clearTimeout: global.clearTimeout,
        setInterval: global.setInterval,
        setTimeout: global.setTimeout,
      };
      // Prefer GlobalWindow to run happy-dom in the global scope so globals like
      // TextEncoder and Uint8Array are correctly exposed; fall back to Window for
      // backward compatibility with older happy-dom versions that lack GlobalWindow.
      const WindowClass = GlobalWindow || Window;
      const win = new WindowClass({
        ...options,
        url: options.url || 'http://localhost:3000',
        console: console && global.console ? global.console : undefined,
      });
      const cleanupHandler = addDefaultErrorHandler(win as unknown as Window);
      const cleanupObjectURLs = installObjectURLTracker(
        win.URL as unknown as typeof URL,
      );

      const cleanupGlobal = installGlobal(global, win, {
        additionalKeys: [
          // jsdom doesn't support Request and Response, but happy-dom does.
          'Request',
          'Response',
          'MessagePort',
          'fetch',
          'URL',
        ],
      });
      const cleanupTimers = installTimerTracking(global, nodeTimers);

      return {
        async teardown() {
          cleanupHandler();
          cleanupTimers();
          cleanupObjectURLs();
          if (win.close && win.happyDOM.abort) {
            await win.happyDOM.abort();
            win.close();
          } else {
            await win.happyDOM.cancelAsync();
          }
          cleanupGlobal();
        },
      };
    },
  };
