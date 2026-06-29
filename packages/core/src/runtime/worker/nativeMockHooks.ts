// Default import (not `{ registerHooks }`): on Node < 22.15 / < 23.5 the named
// export does not exist and a named import would fail at link time. The default
// export (the `Module` class) carries `registerHooks` as a static when present,
// so a property read feature-detects safely.
import nodeModule from 'node:module';
import {
  getNativeMock,
  getRegistryVersion,
  isRegistryEmpty,
  REGISTRY_URL,
  setNativeMockInstaller,
} from './mockRegistry';
import { isBuiltinSpecifier, toNodeBuiltin } from './resolveDynamicImport';

const VIRTUAL_PREFIX = 'rstest-mock:';

// Export names that are valid JS identifiers — only these can be re-emitted as
// `export const <name>` in the synthetic module the load hook generates.
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// rstest's own runtime lives in the same directory as this module's compiled
// chunk. Imports originating from there (including the synthetic mock module's
// `import { getNativeMock } from <REGISTRY_URL>`, which pulls in this dist chunk
// and its `node:` imports) must NEVER be redirected: doing so would (a) wrongly
// mock builtins for rstest's own internals and (b) form a circular
// synthetic → dist chunk → mocked builtin → synthetic load. Gate the hook on the
// importer being OUTSIDE this directory.
const RSTEST_DIST_DIR = REGISTRY_URL.slice(
  0,
  REGISTRY_URL.lastIndexOf('/') + 1,
);

/**
 * #1454: install the Node `module.registerHooks` resolve/load pair that makes
 * `rs.mock` reach a mocked module imported INSIDE a natively-loaded module —
 * both a true-external `A` (a node_modules package rstest externalizes) and a
 * local module reached via a non-literal `import(variable)` (which rstest loads
 * through Node's loader, outside the bundle). The webpack-runtime mock path only
 * covers bundled modules; such a module's internal `import 'B'` is resolved by
 * Node's loader. Node's IN-THREAD synchronous `module.registerHooks` runs in
 * this same worker realm, so its resolve/load pair can consult the
 * module-scoped `mockRegistry` directly (no thread bridge, no structuredClone,
 * no globalThis) and redirect such imports to the mock.
 *
 * Installed LAZILY — `mockRegistry.setNativeMock` triggers it on the first
 * published mock and then nulls its installer, so this runs exactly once and a
 * run with no module mocks never registers anything on Node's module loader.
 * Feature-detected: `registerHooks` requires Node >= 22.15 / >= 23.5; on older
 * Node this is a no-op and the natively-loaded-internal case stays unmocked
 * exactly as before (graceful fallback, never a crash).
 *
 * Known limitation: an ASYNC mock factory is not applied to a natively-loaded
 * module — the resolve/load hooks are synchronous, so a factory whose exports
 * settle on a promise yields no servable exports and the import resolves to the
 * REAL module. Synchronous factories (the common case, and #1454's repro) are
 * unaffected.
 */
export const installNativeMockHooks = (): void => {
  if (typeof nodeModule.registerHooks !== 'function') {
    return;
  }
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      // Hot path: fires on EVERY native resolution. Bail before any work while
      // no mock is active (also covers the worker's own bootstrap imports), or
      // when the importer is rstest's own runtime (see RSTEST_DIST_DIR).
      if (isRegistryEmpty() || context.parentURL?.startsWith(RSTEST_DIST_DIR)) {
        return nextResolve(specifier, context);
      }
      // `registerHooks` also fires for `require()`, but the load hook only serves
      // an ESM synthetic (`format: 'module'`) the CommonJS loader can't require.
      // Leave require resolutions to Node so a natively-loaded CJS module gets the
      // real module instead of a format mismatch — native mocks reach ESM inner
      // imports only.
      if (context.conditions?.includes('require')) {
        return nextResolve(specifier, context);
      }
      const virtual = (key: string) => ({
        url: `${VIRTUAL_PREFIX}${encodeURIComponent(key)}?v=${getRegistryVersion()}`,
        shortCircuit: true,
      });
      // `getNativeMock` (not a bare presence check) so we only short-circuit when
      // the mock yields SERVABLE exports: an async producer settles to `undefined`
      // here and the resolution falls through to the real module rather than an
      // empty synthetic one, while a producer that THROWS propagates its error so
      // a broken mock surfaces instead of silently serving the real module.
      //
      // Builtins key by their canonical `node:` id without resolving — and
      // CRUCIALLY without calling `import.meta.resolve`, which would re-enter
      // this very hook and recurse. The bare/prefixed spellings collapse to one
      // key so `rs.mock('node:os')` matches an external's `import 'os'`.
      if (isBuiltinSpecifier(specifier)) {
        const key = toNodeBuiltin(specifier);
        return getNativeMock(key) !== undefined
          ? virtual(key)
          : nextResolve(specifier, context);
      }
      // Everything else: let the hook chain perform the real resolution (this is
      // the resolution we would do on passthrough anyway, so no extra cost and
      // no recursion), then key by the resolved URL.
      const resolved = nextResolve(specifier, context);
      if (resolved?.url && getNativeMock(resolved.url) !== undefined) {
        return virtual(resolved.url);
      }
      return resolved;
    },
    load(url, context, nextLoad) {
      if (!url.startsWith(VIRTUAL_PREFIX)) {
        return nextLoad(url, context);
      }
      const key = decodeURIComponent(
        url.slice(VIRTUAL_PREFIX.length).split('?')[0]!,
      );
      const mock = getNativeMock(key) ?? {};
      const names = Object.keys(mock).filter(
        (name) => name !== 'default' && IDENT_RE.test(name),
      );
      // Re-export each known export from the live registry entry by the exact
      // same instance the worker writes to (same REGISTRY_URL). Re-export the
      // value directly — NOT a call wrapper — so a class export stays
      // constructible (`new X()`) and `this`/identity are preserved. Equivalent
      // to the prior per-call wrapper for liveness: `__m` is fixed for a given
      // mock version, and a re-mock bumps the synthetic module's `?v=` URL so
      // `__m` is re-read on the next load.
      const keyLit = JSON.stringify(key);
      const body = names
        .map((name) => `export const ${name} = __m[${JSON.stringify(name)}];`)
        .join('\n');
      // Mirror `defineExportsWithCjsInterop`: re-export an explicit `default`;
      // otherwise synthesize the whole object as the default ONLY for a
      // CJS-shaped mock (no `__esModule`). An `__esModule` mock without a
      // default provides no default export, exactly as the bundled path does.
      const defaultLine =
        'default' in mock
          ? 'export default __m.default;'
          : (mock as { __esModule?: unknown }).__esModule
            ? ''
            : 'export default __m;';
      const source =
        `import { getNativeMock } from ${JSON.stringify(REGISTRY_URL)};\n` +
        `const __m = getNativeMock(${keyLit}) ?? {};\n` +
        `${body}\n` +
        `${defaultLine}\n`;
      return { format: 'module', source, shortCircuit: true };
    },
  });
};

// Registered at worker bootstrap (this module is side-effect imported by
// `setup.ts`); `mockRegistry.setNativeMock` invokes it on the first published mock.
setNativeMockInstaller(installNativeMockHooks);
