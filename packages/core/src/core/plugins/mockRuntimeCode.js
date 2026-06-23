// Rstest runtime code should be prefixed with `rstest_` to avoid conflicts with other runtimes.

//#region federation dynamic import fallback
// Async-node outputs (including Module Federation runtimes) externalize
// dynamic imports to `__rstest_dynamic_import__(specifier, attrs, origin)`
// calls. Chunks
// evaluated via vm/eval — instead of the worker's `loadModule` — never receive
// the function-argument injection that normally provides that hook, so the
// free-identifier lookup falls through to `globalThis`. Provide a fallback
// there that preserves the injected origin before falling back to Node's native
// dynamic import. (This runtime module is emitted inside its own IIFE, so a
// local binding could never be observed by module factories — the global is the
// only effective channel.)
if (globalThis.__rstest_federation__) {
  globalThis.__rstest_dynamic_import__ =
    globalThis.__rstest_dynamic_import__ ||
    function (specifier, importAttributes, origin) {
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
      if (origin && !/^[A-Za-z][A-Za-z\d+\-.]*:/.test(specifier)) {
        return Promise.all([import('node:module'), import('node:url')]).then(
          ([module, url]) => {
            if (
              specifier.startsWith('node:') ||
              module.builtinModules.includes(specifier)
            ) {
              return import(specifier, importAttributes);
            }
            if (/^\.\.?(?:[\\/]|$)/.test(specifier)) {
              return import(
                new URL(specifier, url.pathToFileURL(origin)).href,
                importAttributes
              );
            }
            return import(
              url.pathToFileURL(
                module
                  .createRequire(url.pathToFileURL(origin).href)
                  .resolve(specifier),
              ).href,
              importAttributes
            );
          },
        );
      }
      return import(specifier, importAttributes);
    };
}
//#endregion

const originalWebpackRequire = __webpack_require__;

//#region proxy __webpack_require__
__webpack_require__ = new Proxy(
  function (...args) {
    try {
      return originalWebpackRequire(...args);
    } catch (e) {
      const errMsg = e.message ?? e.toString();
      if (errMsg.includes('__webpack_modules__[moduleId] is not a function')) {
        throw new Error(`[Rstest] Cannot find module "${args[0]}"`);
      }
      throw e;
    }
  },
  {
    set(target, property, value) {
      if (
        globalThis.__rstest_federation__ &&
        property === 'f' &&
        value &&
        typeof value === 'object'
      ) {
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
        const proxied = new Proxy(value, {
          set(obj, key, val) {
            if ((key === 'readFileVm' || key === 'require') && obj[key]) {
              console.warn(
                `[Rstest Federation] Ignoring attempt to overwrite __webpack_require__.f.${String(
                  key,
                )} after it was initialized.`,
              );
              return true;
            }
            obj[key] = val;
            return true;
          },
        });
        target[property] = proxied;
        originalWebpackRequire[property] = proxied;
        return true;
      }
      target[property] = value;
      originalWebpackRequire[property] = value;
      return true;
    },
    get(target, property) {
      if (property in target) {
        return target[property];
      }
      return originalWebpackRequire[property];
    },
  },
);
//#endregion

__webpack_require__.rstest_original_modules = {};
__webpack_require__.rstest_original_module_factories = {};

// Clean request (e.g. `node:child_process`) -> the module id the mock was
// installed on. A dynamic `import(request)` of an external carries a different
// module id than the one the hoisted `rs.mock` patched, so
// `rstest_dynamic_require` redirects it to the mocked id by request.
// Null-prototype because keys are user-controlled request strings that must
// not collide with `Object.prototype` members.
__webpack_require__.rstest_mocked_ids_by_request = Object.create(null);

//#region federation chunk handler placeholders
// When `__webpack_require__.f` was populated before this runtime module ran,
// the pre-seeding in the `set` trap above never saw it, and Module Federation
// placeholder handlers that throw until the federation runtime initializes
// may already be installed. Replace them with no-ops — the real runtime
// overrides them once it boots.
if (globalThis.__rstest_federation__ && __webpack_require__.f) {
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

const hasOwn = (target, property) => Object.hasOwn(target, property);

const isPromise = (value) => value instanceof Promise;

// Restore a module id to its captured original factory and drop its cache
// entry — undoing a mock.
const restoreOriginalFactory = (id) => {
  const factory = __webpack_require__.rstest_original_module_factories[id];
  if (factory) {
    __webpack_modules__[id] = factory;
  }
  delete __webpack_module_cache__[id];
};

// Capture a module id's current factory as its original, once — the inverse of
// restoreOriginalFactory. No-op if already captured.
const captureOriginalFactory = (id) => {
  if (!hasOwn(__webpack_require__.rstest_original_module_factories, id)) {
    __webpack_require__.rstest_original_module_factories[id] =
      __webpack_modules__[id];
  }
};

/**
 * Define named exports on __webpack_exports__ from a module object, and
 * auto-create a `default` export for CJS-style modules that lack one.
 * This preserves `import foo from 'mod'` behavior for mocked CJS modules.
 */
const defineExportsWithCjsInterop = (
  moduleObj,
  __webpack_exports__,
  __webpack_require__,
) => {
  __webpack_require__.r(__webpack_exports__);
  for (const key of Object.getOwnPropertyNames(moduleObj)) {
    __webpack_require__.d(__webpack_exports__, {
      [key]: () => moduleObj[key],
    });
  }
  if (!moduleObj.__esModule && !('default' in moduleObj)) {
    __webpack_require__.d(__webpack_exports__, {
      default: () => moduleObj,
    });
  }
};

const createMockedModule = (originalModule, isSpy) => {
  return (
    globalThis.RSTEST_API?.rstest?.mockObject(originalModule, {
      spy: isSpy,
    }) || originalModule
  );
};

//#region rs.unmock
__webpack_require__.rstest_unmock = (id, request) => {
  restoreOriginalFactory(id);

  // `request` is `undefined` under an older @rspack/core that omits the request
  // literal; the guard can be dropped once the minimum @rspack/core always emits it.
  if (request !== undefined) {
    delete __webpack_require__.rstest_mocked_ids_by_request[request];
  }
};
//#endregion

//#region rs.doUnmock
__webpack_require__.rstest_do_unmock = __webpack_require__.rstest_unmock;
//#endregion

//#region rs.unmockRequire
__webpack_require__.rstest_unmock_require = __webpack_require__.rstest_unmock;
//#endregion

//#region rs.doUnmockRequire
__webpack_require__.rstest_do_unmock_require =
  __webpack_require__.rstest_do_unmock;
//#endregion

//#region rs.requireActual
__webpack_require__.rstest_require_actual =
  __webpack_require__.rstest_import_actual = (id) => {
    if (hasOwn(__webpack_require__.rstest_original_modules, id)) {
      return __webpack_require__.rstest_original_modules[id];
    }

    if (hasOwn(__webpack_require__.rstest_original_module_factories, id)) {
      const mod = __webpack_require__.rstest_original_module_factories[id];
      const moduleInstance = { exports: {} };
      mod(moduleInstance, moduleInstance.exports, __webpack_require__);
      __webpack_require__.rstest_original_modules[id] = moduleInstance.exports;
      return moduleInstance.exports;
    }
    // Use fallback module if the module is not mocked.
    return __webpack_require__(id);
  };
//#endregion

const getMockImplementation = (mockType = 'mock') => {
  const isMockRequire =
    mockType === 'mockRequire' || mockType === 'doMockRequire';

  // The mock and mockRequire will resolve to different module ids when the module is a dual package.
  return (id, modFactory, request) => {
    // Point a dynamic `import(request)` — which carries a different external
    // module id — at this mocked id, so `rstest_dynamic_require` resolves it
    // here. No-ops under an older @rspack/core that omits the request literal.
    const registerRequestAlias = () => {
      if (request !== undefined) {
        __webpack_require__.rstest_mocked_ids_by_request[request] = id;
      }
    };

    // Swap in a mock factory: install it, drop the stale cache entry, and
    // alias the request to this id.
    const installFactory = (factory) => {
      __webpack_modules__[id] = factory;
      delete __webpack_module_cache__[id];
      registerRequestAlias();
    };

    // Only load the module if it's already in cache (to avoid side effects)
    const hasCachedModule = hasOwn(__webpack_module_cache__, id);
    let requiredModule = hasCachedModule
      ? __webpack_module_cache__[id].exports
      : undefined;
    const wasAlreadyLoaded = hasCachedModule;

    const hasSavedOriginalModule = hasOwn(
      __webpack_require__.rstest_original_modules,
      id,
    );

    if (!hasSavedOriginalModule && hasCachedModule) {
      __webpack_require__.rstest_original_modules[id] = requiredModule;
    }

    captureOriginalFactory(id);

    // Handle options object: { spy: true } or { mock: true }
    if (modFactory && typeof modFactory === 'object') {
      const isSpy = modFactory.spy === true;
      const isMock = modFactory.mock === true;
      if (!isSpy && !isMock) {
        throw new Error(
          `[Rstest] rs.${mockType}() options must be { spy: true } or { mock: true }`,
        );
      }

      // For spy/mock options, we need the original module
      // If it wasn't already loaded, load it now (unavoidable for this feature)
      if (!wasAlreadyLoaded) {
        try {
          requiredModule = __webpack_require__(id);
        } catch {
          const optionName = isSpy ? 'spy' : 'mock';
          throw new Error(
            `[Rstest] rs.${mockType}('${id}', { ${optionName}: true }) failed: cannot load original module`,
          );
        }
      }

      if (!requiredModule) {
        const optionName = isSpy ? 'spy' : 'mock';
        throw new Error(
          `[Rstest] rs.${mockType}('${id}', { ${optionName}: true }) failed: cannot load original module`,
        );
      }
      const mockedModule = isPromise(requiredModule)
        ? requiredModule.then((originalModule) =>
            createMockedModule(originalModule, isSpy),
          )
        : createMockedModule(requiredModule, isSpy);

      const finalModFactory = function (
        __webpack_module__,
        __webpack_exports__,
        __webpack_require__,
      ) {
        if (isPromise(mockedModule)) {
          __webpack_module__.exports = mockedModule;
          return;
        }

        if (isMockRequire) {
          __webpack_module__.exports = mockedModule;
          return;
        }

        defineExportsWithCjsInterop(
          mockedModule,
          __webpack_exports__,
          __webpack_require__,
        );
      };

      installFactory(finalModFactory);
      return;
    }

    if (typeof modFactory === 'string' || typeof modFactory === 'number') {
      // Manual mock resolved to a module id. Install a factory that requires it
      // (rather than only seeding the cache) so the mock survives
      // `rs.resetModules()` — which clears the cache — the same way function
      // factories do. A cache-only entry would be dropped on reset, leaving a
      // later `import()` to fall back to the original (real) module.
      const finalModFactory = function (__webpack_module__) {
        __webpack_module__.exports = __webpack_require__(modFactory);
      };

      installFactory(finalModFactory);
    } else if (typeof modFactory === 'function') {
      const finalModFactory = function (
        __webpack_module__,
        __webpack_exports__,
        __webpack_require__,
      ) {
        const res = modFactory();

        if (isPromise(res)) {
          throw new Error(
            `[Rstest] An async mock factory is not supported. ` +
              `Use a sync factory; to keep part of the original module, ` +
              `import it with \`with { rstest: 'importActual' }\` and spread it in.`,
          );
        }

        if (isMockRequire) {
          __webpack_module__.exports = res;
          return;
        }

        defineExportsWithCjsInterop(
          res,
          __webpack_exports__,
          __webpack_require__,
        );
      };

      installFactory(finalModFactory);
    }
  };
};

// #region rs.mock
__webpack_require__.rstest_mock = getMockImplementation('mock');
// #endregion

// #region rs.mockRequire
__webpack_require__.rstest_mock_require = getMockImplementation('mockRequire');
// #endregion

// #region rs.doMock
__webpack_require__.rstest_do_mock = getMockImplementation('doMock');
// #endregion

// #region rs.doMockRequire
__webpack_require__.rstest_do_mock_require =
  getMockImplementation('doMockRequire');
// #endregion

//#region dynamic import() interception
/**
 * Resolves an externalized `await import(request)`. rspack gives the dynamic
 * import a different external module id (`id`) than the one the hoisted
 * `rs.mock` patched, so the mocked id is looked up by `request` and required
 * in place of `id` — the mock keeps one instance per request, `id`'s factory
 * and cache are never touched, and `rs.unmock` needs no per-id undo. When the
 * request isn't mocked, behave exactly like `__webpack_require__(id)`.
 */
__webpack_require__.rstest_dynamic_require = (id, request) => {
  const mockedId = __webpack_require__.rstest_mocked_ids_by_request[request];
  return __webpack_require__(mockedId !== undefined ? mockedId : id);
};
//#endregion

//#region rs.reset_modules
__webpack_require__.rstest_reset_modules = () => {
  const mockedIds = Object.keys(__webpack_require__.rstest_original_modules);
  Object.keys(__webpack_module_cache__).forEach((id) => {
    // Do not reset mocks registry.
    if (!mockedIds.includes(id)) {
      delete __webpack_module_cache__[id];
    }
  });
};
//#endregion

//#region rs.hoisted
__webpack_require__.rstest_hoisted = (fn) => {
  return fn();
};
//#endregion
