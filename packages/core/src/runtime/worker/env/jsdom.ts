import type { ConstructorOptions } from 'jsdom';
import type { TestEnvironment } from '../../../types';
import { checkPkgInstalled } from '../../util';
import { addDefaultErrorHandler, installGlobal } from './utils';

type JSDOMOptions = ConstructorOptions & {
  html?: string | ArrayBufferLike;
  console?: boolean;
};

// Per-worker JSDOM cache. With `isolate: 'soft'`, the worker process is reused
// across multiple test files. The expensive part of jsdom setup is the
// `new JSDOM()` constructor (parses HTML, primes ~hundreds of WHATWG
// prototypes); creating a fresh JSDOM per file costs ~300-1000 ms in cold
// processes. By caching the JSDOM instance at module scope (each worker has
// its own module copy), we pay that cost once.
//
// Between files, the `reset()` path:
//   - uninstalls globals (so the previous file's setupFile mutations to
//     `window.X = ...` / Object.defineProperty don't leak)
//   - wipes the DOM tree
//   - reinstalls globals on the same JSDOM window
//
// `installGlobal` defines ~270 getter/setter properties on `global`, which is
// modestly priced (~5-15 ms) but dwarfed by the saved `new JSDOM()` cost.
type Cached = {
  dom: import('jsdom').JSDOM;
  optionsKey: string;
};
let cached: Cached | undefined;

const optionsKey = (options: JSDOMOptions): string => {
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

export const environment: TestEnvironment<typeof globalThis> = {
  name: 'jsdom',
  setup: async (global, options) => {
    checkPkgInstalled('jsdom');
    const { CookieJar, JSDOM, ResourceLoader, VirtualConsole } =
      await import('jsdom');

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

    const key = optionsKey(options as JSDOMOptions);

    // Reuse the cached JSDOM if options match. The DOM has already been reset
    // by the previous file's `reset()` (which uninstalled globals).
    let dom: import('jsdom').JSDOM;
    if (cached && cached.optionsKey === key) {
      dom = cached.dom;
    } else {
      dom = new JSDOM(html as string, {
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
      cached = { dom, optionsKey: key };
    }

    const { cleanup: cleanupGlobal, resetOverrides } = installGlobal(
      global,
      dom.window,
    );
    const cleanupHandler = addDefaultErrorHandler(global as unknown as Window);

    const initialUrl = url;

    return {
      teardown() {
        cleanupHandler();
        try {
          dom.window.close();
        } catch {
          // best-effort
        }
        cleanupGlobal();
        // Clear the cache so the next setup() rebuilds. Required for
        // `isolate: true` to keep per-file fresh-env semantics.
        cached = undefined;
      },
      // Soft reset for `isolate: 'soft'`. Wipes DOM tree, restores location,
      // and clears every `global.X = ...` override made by the previous
      // file's setupFile / tests — but KEEPS the JSDOM instance alive and
      // KEEPS the global property descriptors in place (so `window` stays
      // accessible until the next file's setup runs).
      //
      // What gets restored:
      //   - DOM tree (`document.body`/`document.head` reset to empty)
      //   - Window location (back to `initialUrl`)
      //   - All overridden globals (`window.matchMedia = jest.fn()` etc.) →
      //     defaults sourced from `dom.window` (the original JSDOM-backed
      //     values).
      //
      // What does NOT get restored automatically:
      //   - Mutations on prototype objects (`Element.prototype.X = ...`).
      //     Use `restoreMocks: true` in your rstest config + `rstest.spyOn`
      //     for those, or set them inside `beforeEach` instead of in a setup
      //     file run-once.
      reset() {
        resetOverrides();
        const doc = dom.window.document;
        try {
          doc.documentElement.innerHTML = '<head></head><body></body>';
        } catch {
          doc.open();
          doc.write('<!DOCTYPE html><html><head></head><body></body></html>');
          doc.close();
        }
        try {
          dom.window.history.replaceState(null, '', initialUrl);
        } catch {
          // location may be locked
        }
      },
    };
  },
};
