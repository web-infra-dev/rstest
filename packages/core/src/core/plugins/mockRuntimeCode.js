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
  for (const key in moduleObj) {
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
      const originalModule = requiredModule;
      const mockedModule =
        globalThis.RSTEST_API?.rstest?.mockObject(originalModule, {
          spy: isSpy,
        }) || originalModule;

      const finalModFactory = function (
        __webpack_module__,
        __webpack_exports__,
        __webpack_require__,
      ) {
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
      __webpack_module_cache__[id] = {
        exports: __webpack_require__(modFactory),
      };
      registerRequestAlias();
    } else if (typeof modFactory === 'function') {
      const finalModFactory = function (
        __webpack_module__,
        __webpack_exports__,
        __webpack_require__,
      ) {
        const res = modFactory();

        if (isPromise(res)) {
          __webpack_module__.exports = res;
          return;
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
