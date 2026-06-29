/**
 * #1454: worker-realm registry of mocks that must be served to
 * modules loaded NATIVELY by Node (true externals). The webpack-runtime mock
 * path only covers bundled modules; when a true-external `A` internally imports
 * a mocked `B`, `A`'s import of `B` is resolved by Node's loader, outside the
 * bundle. A Node `module.registerHooks` resolve/load pair (in
 * `nativeMockHooks.ts`, installed lazily on the first native mock) reads THIS
 * module-scoped map to redirect such imports to the mock.
 *
 * This is plain module-scoped state reached by a normal `import` — NOT a
 * `globalThis` bridge. It is shared between the worker runtime and the synthetic
 * mock modules the load hook generates because both import this file by the same
 * resolved URL (Node dedupes ESM by URL), so there is a single instance.
 */

/** This module's own resolved URL, baked into generated synthetic modules so
 * they re-export from the exact same instance the worker writes to. */
export const REGISTRY_URL: string = import.meta.url;

/**
 * A registered native mock. `produce` yields the mock's exports (the already
 * built mocked module, or a user factory); it is run LAZILY — at most once, and
 * only when the load hook actually serves this mock to a natively-loaded module
 * — so an `rs.mock`/`doMock` factory with side effects keeps its lazy semantics and
 * never runs at registration time. `status` guards that single evaluation: it
 * flips to `resolved` even when the factory yields nothing usable (async/primitive
 * → `exports` `undefined`), or to `errored` when the factory throws (`error` is
 * memoized and re-thrown so a broken factory surfaces on the native path, matching
 * the bundled path).
 */
type NativeMockEntry = {
  produce: () => unknown;
  status: 'pending' | 'resolved' | 'errored';
  exports: Record<string, unknown> | undefined;
  error: unknown;
};

const registry = new Map<string, NativeMockEntry>();

/** Bumped on every mutation; folded into the synthetic module's virtual URL so a
 * re-mock/unmock busts Node's ESM cache for that specifier. */
let version = 0;

// Lazily-installed Node loader hooks (nativeMockHooks.ts). Registered once at
// worker bootstrap and invoked on the first published mock, so a run with no
// module mocks never touches Node's module loader. Stays `undefined` in the
// browser build (nativeMockHooks is node-only and never imported there), where
// native mocks are meaningless.
let installHooks: (() => void) | undefined;

/** Register the lazy hook installer; called by nativeMockHooks at load time. */
export const setNativeMockInstaller = (install: () => void): void => {
  installHooks = install;
};

export const setNativeMock = (key: string, produce: () => unknown): void => {
  // Install the loader hooks on the first published mock, then null the
  // installer: later mocks skip it, and an unsupported-Node attempt is not
  // retried (the install is a no-op there).
  if (installHooks) {
    installHooks();
    installHooks = undefined;
  }
  registry.set(key, {
    produce,
    status: 'pending',
    exports: undefined,
    error: undefined,
  });
  version++;
};

export const unsetNativeMock = (key: string): void => {
  if (registry.delete(key)) {
    version++;
  }
};

export const getNativeMock = (
  key: string,
): Record<string, unknown> | undefined => {
  const entry = registry.get(key);
  if (!entry) {
    return undefined;
  }
  // Evaluate the producer on first use and memoize, so a factory runs exactly
  // once (the resolve hook reads this to decide whether a servable mock exists,
  // then the load hook reads it to list export names and read their values). A
  // callable is servable too (a default-function / CommonJS module export), so
  // only a primitive or a Promise (an async factory) settles to `undefined` — the
  // resolve hook then falls through to the real module (the async-factory
  // limitation in nativeMockHooks). A `Promise` is matched by its toString tag,
  // not a duck-typed `.then`, so a mock that legitimately exports a `then`
  // function is still served. A factory that THROWS is memoized and re-thrown on
  // every access, so a broken mock surfaces the error on the native path instead
  // of silently serving the real module — matching how the bundled path fails a
  // throwing factory.
  if (entry.status === 'pending') {
    // Mark non-pending before producing so a re-entrant call can't re-run it.
    entry.status = 'resolved';
    try {
      const res = entry.produce();
      entry.exports =
        res !== null &&
        (typeof res === 'object' || typeof res === 'function') &&
        Object.prototype.toString.call(res) !== '[object Promise]'
          ? (res as Record<string, unknown>)
          : undefined;
    } catch (error) {
      entry.status = 'errored';
      entry.error = error;
    }
  }
  if (entry.status === 'errored') {
    throw entry.error;
  }
  return entry.exports;
};

export const isRegistryEmpty = (): boolean => registry.size === 0;

export const getRegistryVersion = (): number => version;
