import type { Window as HappyDOMWindow } from 'happy-dom';
import type { TestEnvironment } from '../../../types';
import { checkPkgInstalled } from '../../util';
import { addDefaultErrorHandler, installGlobal } from './utils';

type HappyDOMOptions = ConstructorParameters<typeof HappyDOMWindow>[0];

// Per-worker cache — see env/jsdom.ts for full rationale.
type Cached = {
  win: HappyDOMWindow;
  optionsKey: string;
};
let cached: Cached | undefined;

const optionsKey = (options: HappyDOMOptions): string => {
  try {
    return JSON.stringify(options, (_k, v) => {
      if (typeof v === 'function') return '__fn__';
      if (
        v &&
        typeof v === 'object' &&
        v.constructor &&
        v.constructor.name !== 'Object' &&
        !Array.isArray(v)
      ) {
        return '__opaque__';
      }
      return v;
    });
  } catch {
    return Math.random().toString(36);
  }
};

export const environment: TestEnvironment<typeof globalThis, HappyDOMOptions> =
  {
    name: 'happy-dom',
    setup: async (global, options = {}) => {
      checkPkgInstalled('happy-dom');

      const key = optionsKey(options);

      let win: HappyDOMWindow;
      if (cached && cached.optionsKey === key) {
        win = cached.win;
      } else {
        const { Window, GlobalWindow } = await import('happy-dom');
        const WindowClass = GlobalWindow || Window;
        win = new WindowClass({
          ...options,
          url: options.url || 'http://localhost:3000',
          console: console && global.console ? global.console : undefined,
        });
        cached = { win, optionsKey: key };
      }

      const { cleanup: cleanupGlobal, resetOverrides } = installGlobal(
        global,
        win,
        {
          additionalKeys: ['Request', 'Response', 'MessagePort', 'fetch'],
        },
      );

      const cleanupHandler = addDefaultErrorHandler(
        global as unknown as Window,
      );

      const initialUrl = options.url || 'http://localhost:3000';

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
          cached = undefined;
        },
        async reset() {
          resetOverrides();
          const doc = win.document;
          try {
            doc.documentElement.innerHTML = '<head></head><body></body>';
          } catch {
            doc.open();
            doc.write('<!DOCTYPE html><html><head></head><body></body></html>');
            doc.close();
          }
          try {
            win.history.replaceState(null, '', initialUrl);
          } catch {
            // location may be locked
          }
          if (typeof win.happyDOM?.cancelAsync === 'function') {
            try {
              await win.happyDOM.cancelAsync();
            } catch {
              // best-effort
            }
          }
        },
      };
    },
  };
