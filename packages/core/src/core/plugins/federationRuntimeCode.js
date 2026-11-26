//#region federation dynamic import fallback
// Async-node outputs (including Module Federation runtimes) externalize
// dynamic imports to `__rstest_dynamic_import__(specifier, attrs, origin)`
// calls. Chunks
// evaluated via vm/eval — instead of the worker's `loadModule` — never receive
// the function-argument injection that normally provides that hook, so the
// free-identifier lookup falls through to `globalThis`. Provide a fallback
// there that preserves the injected origin, or the worker's current source file
// origin when injection is unavailable, before falling back to Node's native
// dynamic import. (This runtime module is emitted inside its own IIFE, so a
// local binding could never be observed by module factories — the global is the
// only effective channel.)
globalThis.__rstest_dynamic_import__ =
  globalThis.__rstest_dynamic_import__ ||
  function (specifier, importAttributes, origin) {
    const fallbackOrigin =
      origin || globalThis.__rstest_dynamic_import_origin__;
    // Absolute filesystem paths must round-trip through `pathToFileURL`
    // before reaching native `import()`: Windows drive letters (`C:\...`)
    // would otherwise be parsed as a URL scheme, and `#` / `%` in paths
    // need percent-encoding — the same normalization the worker applies in
    // `resolveDynamicImport.ts`.
    if (/^(?:[A-Za-z]:[\\/]|[\\/])/.test(specifier)) {
      return import('node:url').then(
        (url) => import(url.pathToFileURL(specifier).href, importAttributes),
      );
    }
    if (fallbackOrigin && !/^[A-Za-z][A-Za-z\d+\-.]*:/.test(specifier)) {
      return Promise.all([
        import('node:module'),
        import('node:url'),
        import(
          'data:text/' +
            'javascript,export const resolve=(specifier,parent)=>import.meta.resolve(specifier,parent)'
        ),
      ]).then(([module, url, esm]) => {
        if (
          specifier.startsWith('node:') ||
          module.builtinModules.includes(specifier)
        ) {
          return import(specifier, importAttributes);
        }
        if (/^\.\.?(?:[\\/]|$)/.test(specifier)) {
          return import(
            new URL(specifier, url.pathToFileURL(fallbackOrigin)).href,
            importAttributes
          );
        }
        return import(
          esm.resolve(specifier, url.pathToFileURL(fallbackOrigin).href),
          importAttributes
        );
      });
    }
    return import(specifier, importAttributes);
  };
//#endregion

//#region suppress the federation runtime's chunk-handler caution
// `@module-federation/node`'s runtime plugin warns whenever it sees a
// `require` chunk handler, assuming a build it may fail to patch. rstest
// picks `chunkLoading: 'require'` deliberately (chunks must resolve from the
// in-memory assets, not fs) and the handler freeze below turns the patch
// attempt into a guarded no-op, so the warning is pure noise for every
// federation test file. Filter exactly that message; if its wording ever
// changes this fails open and the warning simply shows again.
if (!globalThis.__rstest_mf_caution_filtered__) {
  globalThis.__rstest_mf_caution_filtered__ = true;
  const rstestOriginalConsoleWarn = console.warn;
  console.warn = function (...args) {
    if (
      typeof args[1] === 'string' &&
      args[1].includes('build target is not set to "async-node"')
    ) {
      return;
    }
    rstestOriginalConsoleWarn.apply(this, args);
  };
}
//#endregion

rstestRequireHandlers.set = function (target, property, value) {
  if (property === 'f' && value && typeof value === 'object') {
    // The bundler assigns `__webpack_require__.f = {}` early, and later
    // runtime modules install throwing placeholders via
    // `f.consumes = f.consumes || thrower`. Pre-seeding no-ops keeps the
    // placeholders from ever being installed, so eager chunk loading
    // cannot fail before the federation runtime initializes.
    value.consumes ??= function () {};
    value.remotes ??= function () {};

    // Module Federation's Node runtime plugin patches chunk-loading
    // handlers (`readFileVm` / `require`) to load chunks via native
    // require, which would evaluate them outside this runtime instance
    // and lose Rstest's mocks and shims. Freeze those handlers once
    // Rspack installs them.
    const frozenHandlers = new Proxy(value, {
      set(obj, key, val) {
        if ((key === 'readFileVm' || key === 'require') && obj[key]) {
          // Deliberately claim success: the federation runtime assigns in
          // strict mode, and returning false would turn the intended
          // silent drop into a TypeError at its call site.
          return true;
        }
        return Reflect.set(obj, key, val);
      },
    });
    return Reflect.set(target, property, frozenHandlers);
  }
  return Reflect.set(target, property, value);
};

//#region federation chunk handler placeholders
// When `__webpack_require__.f` was populated before this runtime module ran,
// the pre-seeding in the `set` trap above never saw it, and Module Federation
// placeholder handlers that throw until the federation runtime initializes
// may already be installed. Replace them with no-ops — the real runtime
// overrides them once it boots.
if (__webpack_require__.f) {
  for (const key of ['consumes', 'remotes']) {
    if (typeof __webpack_require__.f[key] !== 'function') {
      continue;
    }
    const source = Function.prototype.toString.call(__webpack_require__.f[key]);
    // The bundler generates placeholders whose body throws
    // `"should have __webpack_require__.f.<key> ..."`.
    if (
      source.includes('should have __webpack_require__.f.') ||
      source.includes('should have __webpack_require__.f[')
    ) {
      __webpack_require__.f[key] = function () {};
    }
  }
  // The pre-existing `f` was assigned before the proxy above was installed,
  // so it never went through the `set` trap and its chunk-loading handlers
  // (`readFileVm` / `require`) are unguarded against Module Federation's Node
  // runtime overwriting them. Route a re-assignment through the proxy so the
  // same guard wrapping applies in this ordering too.
  const preexistingChunkHandlers = __webpack_require__.f;
  __webpack_require__.f = preexistingChunkHandlers;
}
//#endregion
