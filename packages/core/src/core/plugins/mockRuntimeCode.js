// Rstest runtime code should be prefixed with `rstest_` to avoid conflicts with other runtimes.

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

const hasOwn = (target, property) => Object.hasOwn(target, property);

// The other builtin spelling of a request (`os` <-> `node:os`). Used to treat
// both spellings as one mock: the resolver reads under either, and unmock clears
// both. A non-builtin's toggled key is never in the map, so it's a harmless miss.
const altBuiltinSpelling = (request) =>
  request.startsWith('node:') ? request.slice(5) : `node:${request}`;

// Realm-safe (a cross-realm Promise fails `instanceof`), matching the worker
// registry's async detection in `mockRegistry.getNativeMock`.
const isPromise = (value) =>
  Object.prototype.toString.call(value) === '[object Promise]';

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

// #1454: register a mock's exports PRODUCER with the worker-realm native-mock
// registry so a Node `registerHooks` load hook can serve them to a module loaded
// NATIVELY by Node — a true-external `A` (a node_modules package), or a local
// module reached via a non-literal `import(variable)` (loaded outside the
// bundle) — that internally imports this mocked module. Routed over the existing
// RSTEST_API channel (same as `mockObject`).
//
// `produce` yields the mock's exports: the already-built mocked module for the
// spy/mock-option path (the SAME instance bundle consumers see, via its getters),
// or the raw factory for a function mock. It is NOT run here — only the thunk is
// handed to the worker, which runs it LAZILY (once, memoized) the first time the
// load hook actually serves this mock. This preserves `rs.mock`/`doMock` lazy
// factory semantics: a factory with side effects, or one referencing module-level
// imports not yet evaluated when the hoisted `rs.mock` runs, never runs at
// registration time and never runs at all when no natively-loaded module imports
// the mock. Still queued on a microtask so publish/unpublish stay ordered (see
// `unpublishNativeMock`).
//
// LIMITATION (function factory only): the factory runs a second time on the
// worker side (at native-import time), so the native-realm mock is a SEPARATE
// instance from the bundle's. A spy created inside the factory (`rs.fn()`) is
// therefore a different object on each side, so asserting — through the bundle
// handle — calls made via the natively-loaded module will not see them. Sync
// object-returning factories (the #1454 repro) and the spy/mock-option path are
// unaffected.
const publishNativeMock = (request, produce) => {
  const api = globalThis.RSTEST_API?.rstest;
  if (!api || typeof api.__setNativeMock !== 'function') {
    return;
  }
  queueMicrotask(() => {
    api.__setNativeMock(request, produce);
  });
};

// Deferred on a microtask like `publishNativeMock` so install→uninstall order is
// preserved: a synchronous unpublish would run BEFORE the deferred publish
// microtask, which would then re-add a stale entry. Queuing both keeps the last
// operation winning (`rs.mock` then `rs.unmock` ⇒ removed).
const unpublishNativeMock = (request) => {
  queueMicrotask(() => {
    const api = globalThis.RSTEST_API?.rstest;
    if (api && typeof api.__unsetNativeMock === 'function') {
      api.__unsetNativeMock(request);
    }
  });
};

//#region rs.unmock
__webpack_require__.rstest_unmock = (id, request) => {
  restoreOriginalFactory(id);

  const map = __webpack_require__.rstest_mocked_ids_by_request;
  delete map[request];
  // `os` and `node:os` are equivalent, so an unmock with either spelling must
  // clear both (mirrors the resolver's read-side alt lookup).
  delete map[altBuiltinSpelling(request)];
  unpublishNativeMock(request);
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
    // module id — at this mocked id, so `rstest_dynamic_require` resolves it here.
    const registerRequestAlias = () => {
      __webpack_require__.rstest_mocked_ids_by_request[request] = id;
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
      publishNativeMock(request, () => mockedModule);
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
      // Manual mock (`__mocks__`) — publish the SAME bundled instance so a
      // natively-loaded module that imports this mocked module sees it too.
      // `__webpack_require__(modFactory)` is cache-safe (same call as the factory
      // above), so there is no separate-instance divergence here.
      publishNativeMock(request, () => __webpack_require__(modFactory));
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
      publishNativeMock(request, modFactory);
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

//#region non-literal dynamic import() mock resolution
/**
 * Expose the mocked instance for a clean `request` to the worker's native import
 * hook (loadEsModule/loadModule `defineRstestDynamicImport`), which handles a
 * non-literal `import(variable)` outside the webpack runtime. `const s='node:os';
 * import(s)` then resolves `s` to the mocked module here instead of natively
 * loading the real one. Published on the shared `globalThis` because the worker
 * hook has no `__webpack_require__`; returns `undefined` when the request isn't
 * mocked, so the hook performs its normal native import.
 */
globalThis.__rstest_resolve_mocked_dynamic_request__ = (request) => {
  const map = __webpack_require__.rstest_mocked_ids_by_request;
  let mockedId = map[request];
  if (mockedId === undefined) {
    // A builtin may be mocked under its other spelling (`os` vs `node:os`),
    // mirroring the native hook's builtin canonicalization.
    mockedId = map[altBuiltinSpelling(request)];
  }
  return mockedId !== undefined ? __webpack_require__(mockedId) : undefined;
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
