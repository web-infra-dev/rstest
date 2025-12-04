/** biome-ignore-all lint/complexity/useArrowFunction: <follow webpack runtime code convention> */
// Rstest runtime code should be prefixed with `rstest_` to avoid conflicts with other runtimes.

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
