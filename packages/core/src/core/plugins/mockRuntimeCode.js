/** biome-ignore-all lint/complexity/useArrowFunction: <follow webpack runtime code convention> */
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

const hasOwn = (target, property) => Object.hasOwn(target, property);

const isPromise = (value) => value instanceof Promise;

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

  // The mock and mockRequire will resolve to different module ids when the module is a dual package
  return (id, modFactory) => {
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
    const hasSavedOriginalFactory = hasOwn(
      __webpack_require__.rstest_original_module_factories,
      id,
    );

    if (!hasSavedOriginalModule && hasCachedModule) {
      __webpack_require__.rstest_original_modules[id] = requiredModule;
    }

    if (!hasSavedOriginalFactory) {
      __webpack_require__.rstest_original_module_factories[id] =
        __webpack_modules__[id];
    }

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

      __webpack_modules__[id] = finalModFactory;
      delete __webpack_module_cache__[id];
      return;
    }

    if (typeof modFactory === 'string' || typeof modFactory === 'number') {
      __webpack_module_cache__[id] = {
        exports: __webpack_require__(modFactory),
      };
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

      __webpack_modules__[id] = finalModFactory;
      delete __webpack_module_cache__[id];
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
