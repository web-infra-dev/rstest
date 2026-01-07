/** biome-ignore-all lint/complexity/useArrowFunction: <follow webpack runtime code convention> */
// Rstest runtime code should be prefixed with `rstest_` to avoid conflicts with other runtimes.

// Some async-node outputs (including Module Federation runtimes) are externalized to
// `__rstest_dynamic_import__(<abs-path>)`. Those chunks can be evaluated via vm/eval
// and will not have access to the worker's function-argument injection. Provide a
// safe default that relies on Node's native dynamic import.
//
// The worker will still override this with a richer implementation when available.
var __rstest_dynamic_import__;
try {
  globalThis.__rstest_dynamic_import__ =
    globalThis.__rstest_dynamic_import__ ||
    function (specifier, importAttributes) {
      return import(specifier, importAttributes);
    };
  __rstest_dynamic_import__ = globalThis.__rstest_dynamic_import__;
  try {
    require('node:vm').runInThisContext(
      'var __rstest_dynamic_import__ = globalThis.__rstest_dynamic_import__',
    );
  } catch {}
} catch {}

const originalWebpackRequire = __webpack_require__;
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
      // Ensure chunk handler placeholders never throw before federation runtime
      // initializes. The bundler assigns `__webpack_require__.f = {}` early and
      // later runtimes do `__webpack_require__.f.consumes = __webpack_require__.f.consumes || thrower`.
      // Pre-seeding those keys prevents the thrower from being installed.
      if (property === 'f' && value && typeof value === 'object') {
        value.consumes ??= function () {};
        value.remotes ??= function () {};

        // Module Federation's Node runtime plugin may try to patch chunk loading
        // handlers like `readFileVm` / `require` to load chunks via native require.
        // That breaks Rstest because chunks must be evaluated inside the same
        // runtime instance to preserve mocks and shims.
        //
        // Wrap `__webpack_require__.f` so once Rspack installs our chunk loader,
        // it can't be replaced by other runtimes.
        const proxied = new Proxy(value, {
          set(obj, key, val) {
            if ((key === 'readFileVm' || key === 'require') && obj[key]) {
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

__webpack_require__.rstest_original_modules = {};
__webpack_require__.rstest_original_module_factories = {};

// Module Federation can attach placeholder chunk handlers during bootstrap that
// are later overridden by the federation runtime once it initializes. Our test
// runtime eagerly calls `__webpack_require__.e()` which iterates over all
// `__webpack_require__.f[...]` handlers; if any handler is still a placeholder
// that throws, chunk loading will fail before federation has a chance to patch
// it. Make placeholder handlers no-ops until the real runtime replaces them.
const __rstest_noop_chunk_handler__ = function () {};
if (typeof __webpack_require__.f === 'object' && __webpack_require__.f) {
  for (const k of ['consumes', 'remotes']) {
    if (typeof __webpack_require__.f[k] !== 'function') continue;
    const src = Function.prototype.toString.call(__webpack_require__.f[k]);
    if (src.includes('should have __webpack_require__.f.')) {
      __webpack_require__.f[k] = __rstest_noop_chunk_handler__;
    }
  }
}

//#region rs.unmock
__webpack_require__.rstest_unmock = (id) => {
  const originalModuleFactory =
    __webpack_require__.rstest_original_module_factories[id];

  if (originalModuleFactory) {
    __webpack_modules__[id] = originalModuleFactory;
  }

  delete __webpack_module_cache__[id];
};
//#endregion

//#region rs.doUnmock
__webpack_require__.rstest_do_unmock = __webpack_require__.rstest_unmock;
//#endregion

//#region rs.requireActual
__webpack_require__.rstest_require_actual =
  __webpack_require__.rstest_import_actual = (id) => {
    const originalModule = __webpack_require__.rstest_original_modules[id];
    // Use fallback module if the module is not mocked.
    const fallbackMod = __webpack_require__(id);
    return originalModule ? originalModule : fallbackMod;
  };
//#endregion

// #region rs.mock
__webpack_require__.rstest_mock = (id, modFactory) => {
  let requiredModule;
  try {
    requiredModule = __webpack_require__(id);
  } catch {
    // TODO: non-resolved module
  } finally {
    __webpack_require__.rstest_original_modules[id] = requiredModule;
    __webpack_require__.rstest_original_module_factories[id] =
      __webpack_modules__[id];
  }
  if (typeof modFactory === 'string' || typeof modFactory === 'number') {
    __webpack_module_cache__[id] = { exports: __webpack_require__(modFactory) };
  } else if (typeof modFactory === 'function') {
    const finalModFactory = function (
      __unused_webpack_module,
      __webpack_exports__,
      __webpack_require__,
    ) {
      __webpack_require__.r(__webpack_exports__);
      const res = modFactory();
      for (const key in res) {
        __webpack_require__.d(__webpack_exports__, {
          [key]: () => res[key],
        });
      }
    };

    __webpack_modules__[id] = finalModFactory;
    delete __webpack_module_cache__[id];
  }
};
// #endregion

// #region rs.mockRequire
__webpack_require__.rstest_mock_require = (id, modFactory) => {
  let requiredModule;
  try {
    requiredModule = __webpack_require__(id);
  } catch {
    // TODO: non-resolved module
  } finally {
    __webpack_require__.rstest_original_modules[id] = requiredModule;
    __webpack_require__.rstest_original_module_factories[id] =
      __webpack_modules__[id];
  }
  if (typeof modFactory === 'string' || typeof modFactory === 'number') {
    __webpack_module_cache__[id] = { exports: __webpack_require__(modFactory) };
  } else if (typeof modFactory === 'function') {
    const exports = modFactory();
    __webpack_require__.r(exports);
    __webpack_module_cache__[id] = { exports, id, loaded: true };
  }
};
// #endregion

// #region rs.doMock
__webpack_require__.rstest_do_mock = (id, modFactory) => {
  let requiredModule;
  try {
    requiredModule = __webpack_require__(id);
  } catch {
    // TODO: non-resolved module
  } finally {
    __webpack_require__.rstest_original_modules[id] = requiredModule;
    __webpack_require__.rstest_original_module_factories[id] =
      __webpack_modules__[id];
  }
  if (typeof modFactory === 'string' || typeof modFactory === 'number') {
    __webpack_module_cache__[id] = { exports: __webpack_require__(modFactory) };
  } else if (typeof modFactory === 'function') {
    const exports = modFactory();
    __webpack_require__.r(exports);
    __webpack_module_cache__[id] = { exports, id, loaded: true };
  }
};

// #region rs.doMockRequire
__webpack_require__.rstest_do_mock_require = (id, modFactory) => {
  let requiredModule;
  try {
    requiredModule = __webpack_require__(id);
  } catch {
    // TODO: non-resolved module
  } finally {
    __webpack_require__.rstest_original_modules[id] = requiredModule;
    __webpack_require__.rstest_original_module_factories[id] =
      __webpack_modules__[id];
  }
  if (typeof modFactory === 'string' || typeof modFactory === 'number') {
    __webpack_module_cache__[id] = { exports: __webpack_require__(modFactory) };
  } else if (typeof modFactory === 'function') {
    const exports = modFactory();
    __webpack_require__.r(exports);
    __webpack_module_cache__[id] = { exports, id, loaded: true };
  }
};

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
