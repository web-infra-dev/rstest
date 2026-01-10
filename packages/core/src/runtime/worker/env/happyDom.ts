import type { Window as HappyDOMWindow } from 'happy-dom';
import type { TestEnvironment } from '../../../types';
import { checkPkgInstalled } from '../../util';
import { addDefaultErrorHandler, installGlobal } from './utils';

type HappyDOMOptions = ConstructorParameters<typeof HappyDOMWindow>[0];

export const environment: TestEnvironment<typeof globalThis, HappyDOMOptions> =
  {
    name: 'happy-dom',
    setup: async (global, options = {}) => {
      checkPkgInstalled('happy-dom');
      const { Window } = await import('happy-dom');
      const win = new Window({
        ...options,
        url: options.url || 'http://localhost:3000',
        console: console && global.console ? global.console : undefined,
      });

      // Patch the real window first so that the `installGlobal` bindings to
      // `addEventListener`/`removeEventListener` see the patched versions.
      const cleanupHandler = addDefaultErrorHandler(win as unknown as Window);

      const cleanupGlobal = installGlobal(global, win, {
        // jsdom doesn't support Request and Response, but happy-dom does
        additionalKeys: ['Request', 'Response', 'MessagePort', 'fetch'],
      });

      return {
        async teardown() {
          cleanupHandler();
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
