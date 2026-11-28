// Rstest runtime code should be prefixed with `rstest_` to avoid conflicts with other runtimes.

//#region proxy __webpack_require__
// The proxy target is the original `__webpack_require__` itself, so all
// property operations — get/set/`in`/`for...in`/`hasOwnProperty` — hit the
// one real object through the default traps, regardless of whether a runtime
// property was assigned before or after this proxy was installed. (A
// wrapper-function target splits properties across two objects and needs
// hand-written merge traps for every read path; rspack's HMR runtime, which
// clones `__webpack_require__` per module via `for...in` + `hasOwnProperty`,
// silently drops `.m`/`.c`/`.i` under that split and crashes headed watch.)
rstestRequireHandlers.apply = function (target, thisArg, args) {
  try {
    return Reflect.apply(target, thisArg, args);
  } catch (e) {
    const errMsg = e.message ?? e.toString();
    if (errMsg.includes('__webpack_modules__[moduleId] is not a function')) {
      throw new Error(`[Rstest] Cannot find module "${args[0]}"`);
    }
    throw e;
  }
};
rstestRequireHandlers.set = (target, property, value) =>
  Reflect.set(target, property, value);
__webpack_require__ = new Proxy(__webpack_require__, rstestRequireHandlers);
//#endregion

__webpack_require__.rstest_original_modules = {};
__webpack_require__.rstest_original_module_values = {};
__webpack_require__.rstest_original_module_factories = {};

// ESM and CommonJS conditions can resolve one package request to different
// module ids, so keep their aliases separate. Dynamic imports use the ESM map.
__webpack_require__.rstest_mocked_ids_by_request = Object.create(null);
__webpack_require__.rstest_mocked_ids_by_request_cjs = Object.create(null);

const hasOwn = (target, property) => Object.hasOwn(target, property);

const isPromise = (value) => value instanceof Promise;

// Restore a module id to its captured original factory and drop its cache
// entry — undoing a mock.
const restoreOriginalFactory = (id) => {
  const factory = __webpack_require__.rstest_original_module_factories[id];
  if (factory) {
    __webpack_modules__[id] = factory;
  }
  delete __webpack_require__.rstest_original_module_values[id];
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

// Evaluate an original module in an isolated module record. Auto-mocks use
// this only when their replacement is first required, so registering a mock
// does not execute the target or its dependency graph.
const evaluateOriginalModule = (id) => {
  if (hasOwn(__webpack_require__.rstest_original_modules, id)) {
    return __webpack_require__.rstest_original_modules[id];
  }
  if (hasOwn(__webpack_require__.rstest_original_module_values, id)) {
    return __webpack_require__.rstest_original_module_values[id];
  }

  const factory = __webpack_require__.rstest_original_module_factories[id];
  if (!factory) {
    return undefined;
  }

  const mockedFactory = __webpack_modules__[id];
  const mockedCacheEntry = __webpack_module_cache__[id];
  delete __webpack_module_cache__[id];
  __webpack_modules__[id] = factory;
  try {
    const originalModule = __webpack_require__(id);
    __webpack_require__.rstest_original_module_values[id] = originalModule;
    return originalModule;
  } finally {
    __webpack_modules__[id] = mockedFactory;
    delete __webpack_module_cache__[id];
    if (mockedCacheEntry) {
      __webpack_module_cache__[id] = mockedCacheEntry;
    }
  }
};

/**
 * Define named exports on __webpack_exports__ from a module object, and
 * auto-create a `default` export for CJS-style modules that lack one.
 * This preserves `import foo from 'mod'` behavior for mocked CJS modules.
 */
const defineExportsWithCjsInterop = (moduleObj, __webpack_exports__) => {
  // Rspack's `.d` defines configurable getters, which `rs.spyOn` relies on to
  // redefine exports. Do not replace these with hand-written getters.
  __webpack_require__.r(__webpack_exports__);
  // A null prototype keeps a `__proto__` export as an own getter key.
  const getters = Object.create(null);
  for (const key of Object.getOwnPropertyNames(moduleObj)) {
    getters[key] = () => moduleObj[key];
  }
  if (!moduleObj.__esModule && !('default' in moduleObj)) {
    getters.default = () => moduleObj;
  }
  __webpack_require__.d(__webpack_exports__, getters);
};

const createMockedModule = (originalModule, isSpy) => {
  return (
    globalThis.RSTEST_API?.rstest?.mockObject(originalModule, {
      spy: isSpy,
    }) || originalModule
  );
};

const createUnmockImplementation = (mockedIdsByRequest) => (id, request) => {
  restoreOriginalFactory(id);

  // `request` is `undefined` under an older @rspack/core that omits the request
  // literal; the guard can be dropped once the minimum @rspack/core always emits it.
  if (request !== undefined) {
    delete mockedIdsByRequest[request];
  }
};

//#region rs.unmock
__webpack_require__.rstest_unmock = createUnmockImplementation(
  __webpack_require__.rstest_mocked_ids_by_request,
);
//#endregion

//#region rs.doUnmock
__webpack_require__.rstest_do_unmock = __webpack_require__.rstest_unmock;
//#endregion

//#region rs.unmockRequire
__webpack_require__.rstest_unmock_require = createUnmockImplementation(
  __webpack_require__.rstest_mocked_ids_by_request_cjs,
);
//#endregion

//#region rs.doUnmockRequire
__webpack_require__.rstest_do_unmock_require =
  __webpack_require__.rstest_unmock_require;
//#endregion

//#region rs.requireActual
const getActualModule = (id) => {
  if (hasOwn(__webpack_require__.rstest_original_module_factories, id)) {
    return evaluateOriginalModule(id);
  }
  // Use fallback module if the module is not mocked.
  return __webpack_require__(id);
};

__webpack_require__.rstest_require_actual = (id) => {
  const actualModule = getActualModule(id);
  if (isPromise(actualModule) && hasOwn(actualModule, __webpack_require__.aE)) {
    throw new Error(
      `[Rstest] rs.requireActual() cannot synchronously load "${id}" because its dependency graph uses top-level await. Use the asynchronous rs.importActual() API instead.`,
    );
  }
  return actualModule;
};

__webpack_require__.rstest_import_actual = (id) =>
  Promise.resolve(getActualModule(id));
//#endregion

const getMockImplementation = (mockType = 'mock') => {
  const isMockRequire =
    mockType === 'mockRequire' || mockType === 'doMockRequire';
  const mockedIdsByRequest = isMockRequire
    ? __webpack_require__.rstest_mocked_ids_by_request_cjs
    : __webpack_require__.rstest_mocked_ids_by_request;

  // The mock and mockRequire will resolve to different module ids when the module is a dual package.
  return (id, modFactory, request) => {
    // Point a dynamic `import(request)` — which carries a different external
    // module id — at this mocked id, so `rstest_dynamic_require` resolves it
    // here. No-ops under an older @rspack/core that omits the request literal.
    const registerRequestAlias = () => {
      if (request !== undefined) {
        mockedIdsByRequest[request] = id;
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

      const createMockFactory = (originalModule) => {
        if (!originalModule) {
          const optionName = isSpy ? 'spy' : 'mock';
          throw new Error(
            `[Rstest] rs.${mockType}('${id}', { ${optionName}: true }) failed: cannot load original module`,
          );
        }

        const mockedModule = isPromise(originalModule)
          ? originalModule.then((resolvedModule) =>
              createMockedModule(resolvedModule, isSpy),
            )
          : createMockedModule(originalModule, isSpy);

        return function (
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

          defineExportsWithCjsInterop(mockedModule, __webpack_exports__);
        };
      };

      // If the target was already loaded, preserve the existing behavior and
      // mock that instance immediately. Otherwise defer evaluation until the
      // mocked module is first required, after all hoisted mock registrations
      // have completed.
      const finalModFactory = wasAlreadyLoaded
        ? createMockFactory(requiredModule)
        : function (
            __webpack_module__,
            __webpack_exports__,
            __webpack_require__,
          ) {
            let originalModule;
            try {
              originalModule = evaluateOriginalModule(id);
            } catch {
              const optionName = isSpy ? 'spy' : 'mock';
              throw new Error(
                `[Rstest] rs.${mockType}('${id}', { ${optionName}: true }) failed: cannot load original module`,
              );
            }

            createMockFactory(originalModule)(
              __webpack_module__,
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

        defineExportsWithCjsInterop(res, __webpack_exports__);
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
  const mockedId =
    __webpack_require__.rstest_mocked_ids_by_request[request] ??
    __webpack_require__.rstest_mocked_ids_by_request_cjs[request];
  return __webpack_require__(mockedId !== undefined ? mockedId : id);
};

const resolveRstestMockRequest = (request, origin) => {
  const isRelative =
    request[0] === '.' &&
    (request[1] === '/' ||
      request[1] === '\\' ||
      (request[1] === '.' && (request[2] === '/' || request[2] === '\\')));
  if (!origin || !isRelative) {
    return request;
  }

  const originParts = origin.replaceAll('\\', '/').split('/');
  originParts.pop();
  for (const part of request.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') originParts.pop();
    else originParts.push(part);
  }
  return originParts.join('/') || '/';
};

const findRstestMockedId = (
  request,
  origin,
  mockedIdsByRequest,
  fallbackMockedIdsByRequest,
) => {
  const resolvedRequest = resolveRstestMockRequest(request, origin);
  return (
    mockedIdsByRequest[request] ??
    mockedIdsByRequest[resolvedRequest] ??
    mockedIdsByRequest[`${origin ?? ''}\0${request}`] ??
    fallbackMockedIdsByRequest[request] ??
    fallbackMockedIdsByRequest[resolvedRequest] ??
    fallbackMockedIdsByRequest[`${origin ?? ''}\0${request}`]
  );
};

const getRstestMockTargetId = (
  id,
  request,
  origin,
  mockedIdsByRequest,
  fallbackMockedIdsByRequest,
) => {
  const mockedId = findRstestMockedId(
    request,
    origin,
    mockedIdsByRequest,
    fallbackMockedIdsByRequest,
  );
  const targetId = mockedId !== undefined ? mockedId : id;
  if (targetId === undefined || targetId === null) {
    const originSuffix = origin ? ` from ${JSON.stringify(origin)}` : '';
    throw new Error(
      `[Rstest] Cannot find module ${JSON.stringify(request)}${originSuffix}`,
    );
  }
  return targetId;
};

// `rs.importMock(request)` uses the ESM request alias registered by `rs.mock`. The
// generated dynamic import may have a different module id (or no bundled
// target at all), so prefer the registered mock whenever one exists.
__webpack_require__.rstest_import_mock = (id, request, origin) => {
  if (origin === undefined) {
    origin = request;
    request = id;
    id = undefined;
  }
  return Promise.resolve().then(() => {
    const targetId = getRstestMockTargetId(
      id,
      request,
      origin,
      __webpack_require__.rstest_mocked_ids_by_request,
      __webpack_require__.rstest_mocked_ids_by_request_cjs,
    );
    return __webpack_require__(targetId);
  });
};

// `rs.requireMock(request)` uses the CommonJS alias registered by rs.mockRequire.
__webpack_require__.rstest_require_mock = (id, request, origin) => {
  if (origin === undefined) {
    origin = request;
    request = id;
    id = undefined;
  }
  const targetId = getRstestMockTargetId(
    id,
    request,
    origin,
    __webpack_require__.rstest_mocked_ids_by_request_cjs,
    __webpack_require__.rstest_mocked_ids_by_request,
  );
  return __webpack_require__(targetId);
};

// Non-literal dynamic `import(expr)` calls bypass rspack's static rewrite to
// `rstest_dynamic_require` and flow through the worker's `__rstest_dynamic_import__`
// hook instead. Expose a resolver on `globalThis` so the worker can check the
// active mock registry before falling back to native module loading.
__webpack_require__.rstest_resolve_dynamic_import = (request, origin) => {
  const mockedId = findRstestMockedId(
    request,
    origin,
    __webpack_require__.rstest_mocked_ids_by_request,
    __webpack_require__.rstest_mocked_ids_by_request_cjs,
  );
  if (mockedId === undefined) {
    return undefined;
  }
  return {
    exports: Promise.resolve().then(() => __webpack_require__(mockedId)),
  };
};
if (
  typeof globalThis.__rstest_register_dynamic_import_resolver__ === 'function'
) {
  globalThis.__rstest_register_dynamic_import_resolver__(
    __webpack_require__.rstest_resolve_dynamic_import,
  );
} else {
  globalThis.__rstest_resolve_dynamic_import__ =
    __webpack_require__.rstest_resolve_dynamic_import;
}
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
