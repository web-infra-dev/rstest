// Rstest runtime code should be prefixed with `rstest_` to avoid conflicts with other runtimes.

const originalWebpackRequire = __webpack_require__;

// Async-external exports that have not settled yet. An import-type external
// (see `doExternal` in plugins/external.ts) loads through a native dynamic
// import, so requiring it yields a Promise that the importer's async-deps
// machinery unwraps later. A hoisted function-mock factory may capture such a
// namespace binding (e.g. spread an `importActual` import); the factory
// therefore must not run while any of these are pending — see the
// lazily-materialized mock exports in `getMockImplementation`.
const rstest_pending_async_exports = new Set();
// Every promise ever tracked, so a settled external — whose exports stay the
// SAME cached promise on every later require — is not re-added (and does not
// re-open the pending window) each time another module requires it.
const rstest_tracked_async_exports = new WeakSet();

// Lazy mocks whose factory has not run yet (the lazily-materialized Proxy in
// `getMockImplementation`). The worker invokes every registered flusher after
// the test module graph is evaluated — every captured binding settled — and
// before tests execute (see `runInPool`), so a mock imported ONLY for its
// side effects (`import 'pkg'`, no export ever read) still runs its factory,
// as it does on the eager path. A Set registry rather than a single global
// slot, for the same reason as `__rstest_cache_cleaners__`
// (moduleCacheControl.ts): under `isolate: false` a reused worker holds
// several runtime chunks at once, each with its own mock runtime instance.
const rstest_lazy_mock_factories = [];
(globalThis.__rstest_lazy_mock_flushers__ ??= new Set()).add(() => {
  while (rstest_lazy_mock_factories.length > 0) {
    rstest_lazy_mock_factories.shift()();
  }
});

const trackAsyncExports = (exportsValue) => {
  if (
    isPromise(exportsValue) &&
    !rstest_tracked_async_exports.has(exportsValue)
  ) {
    rstest_tracked_async_exports.add(exportsValue);
    rstest_pending_async_exports.add(exportsValue);
    const untrack = () => rstest_pending_async_exports.delete(exportsValue);
    // `.then(onSettled, onSettled)`, not `.finally` — finally re-throws a
    // rejection into a new promise chain nobody handles (unhandledRejection);
    // the rejection itself still surfaces through the importer's await.
    exportsValue.then(untrack, untrack);
  }
  return exportsValue;
};

//#region proxy __webpack_require__
__webpack_require__ = new Proxy(
  function (...args) {
    try {
      return trackAsyncExports(originalWebpackRequire(...args));
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
        const runFactory = () => {
          const res = modFactory();

          if (isPromise(res)) {
            throw new Error(
              `[Rstest] An async mock factory is not supported. ` +
                `Use a sync factory; to keep part of the original module, ` +
                `import it with \`with { rstest: 'importActual' }\` and spread it in.`,
            );
          }
          return res;
        };

        // The factory may capture async-external namespace bindings (e.g.
        // spread an `importActual` import) that are still unsettled while the
        // importer's harmony requires run. Those bindings are only reassigned
        // to real namespaces when the importer's async-deps `await` resumes,
        // and that await includes THIS mocked dep — so the factory can never
        // run "after the await" as a dep (the importer waits on the mock, the
        // mock would wait on the importer's rebinding). Break the cycle by
        // serving a lazily-materialized namespace: exports settle immediately
        // (a Proxy), the importer resumes and rebinds its vars, and the
        // factory runs on FIRST PROPERTY ACCESS, when the captured bindings
        // are settled namespaces. Only engaged while async externals are
        // actually pending; otherwise the eager path below runs, as before.
        if (rstest_pending_async_exports.size > 0) {
          let materializedExports;
          const materialize = () => {
            if (materializedExports === undefined) {
              const res = runFactory();
              if (isMockRequire) {
                materializedExports = res;
              } else {
                // Same interop policy as the eager path below, applied once
                // at materialization by the same helper, so the two paths
                // cannot diverge.
                materializedExports = {};
                defineExportsWithCjsInterop(
                  res,
                  materializedExports,
                  __webpack_require__,
                );
              }
            }
            return materializedExports;
          };
          // Until the factory has run, the runtime's own module-loading reads
          // must be answered WITHOUT forcing it: the async-deps machinery
          // checks `.then` (thenable) and `Symbol("rspack queues")` (async
          // module), `Object.prototype.toString` reads `Symbol.toStringTag`,
          // and `__webpack_require__.n` reads `__esModule` — all while the
          // captured bindings may still be unsettled (and the mock must not
          // look async, or the importer would await it back into the very
          // cycle this Proxy breaks). `then`/symbols answer undefined;
          // `__esModule` answers `true`, which is a constant of the namespace
          // `defineExportsWithCjsInterop` will build (its `.r` call), so no
          // materialization is needed for a correct answer. Once materialized,
          // every read — including a genuine `then` export — delegates to the
          // real namespace, matching the eager path. Residual limitation: a
          // mock whose FIRST-ever accessed export is named `then` reads
          // `undefined` (indistinguishable from a thenable probe).
          const preMaterializeAnswer = (property) => {
            if (property === '__esModule' && !isMockRequire) {
              return { value: true };
            }
            if (property === 'then' || typeof property === 'symbol') {
              return { value: undefined };
            }
            return undefined;
          };
          // mockRequire serves the factory result verbatim, and that result
          // may be CALLABLE (`rs.mockRequire('pkg', () => () => 'ok')`) — a
          // Proxy is only callable when its target is, so the mockRequire
          // path proxies an arrow function and forwards `apply`. An ARROW
          // function specifically: it has no own non-configurable `prototype`
          // (a regular function's would make the `ownKeys` trap below throw
          // a Proxy invariant violation on `Object.keys`), at the cost of
          // `new` on a
          // lazily-served mockRequire mock throwing — constructing through a
          // Proxy requires a constructible target. The rs.mock path keeps a
          // plain object target: a namespace is never callable.
          const lazyExports = new Proxy(
            isMockRequire ? () => {} : Object.create(null),
            {
              apply(_, thisArg, args) {
                return Reflect.apply(materialize(), thisArg, args);
              },
              get(_, property) {
                if (materializedExports === undefined) {
                  const probed = preMaterializeAnswer(property);
                  if (probed) {
                    return probed.value;
                  }
                }
                return materialize()[property];
              },
              has(_, property) {
                if (materializedExports === undefined) {
                  const probed = preMaterializeAnswer(property);
                  if (probed) {
                    return probed.value !== undefined;
                  }
                }
                return Reflect.has(materialize(), property);
              },
              ownKeys(_) {
                return Reflect.ownKeys(materialize());
              },
              getOwnPropertyDescriptor(_, property) {
                const descriptor = Reflect.getOwnPropertyDescriptor(
                  materialize(),
                  property,
                );
                // `configurable: true` unconditionally: the Proxy target owns
                // no non-configurable properties (an empty object, or an arrow
                // function whose `length`/`name` are configurable), and
                // reporting a non-configurable descriptor for a property the
                // target does not own violates the Proxy invariant and throws.
                return descriptor
                  ? { ...descriptor, configurable: true }
                  : undefined;
              },
            },
          );
          __webpack_module__.exports = lazyExports;
          // Guarantee the factory runs even when nothing ever reads an
          // export (a side-effect-only `import 'pkg'`): the worker flushes
          // this queue once the module graph is evaluated. Guarded so it
          // runs only while this mock still owns the module — after an
          // unmock, re-mock, or resetModules the cache entry is gone (or
          // repopulated by a different factory), and running THIS factory
          // would resurrect a replaced mock's side effects.
          rstest_lazy_mock_factories.push(() => {
            if (__webpack_module_cache__[id]?.exports === lazyExports) {
              materialize();
            }
          });
          return;
        }

        const res = runFactory();

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
