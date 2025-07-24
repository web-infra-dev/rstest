import type { RsbuildPlugin, Rspack } from '@rsbuild/core';

class MockRuntimeRspackPlugin {
  apply(compiler: Rspack.Compiler) {
    const { RuntimeModule } = compiler.webpack;
    class RetestImportRuntimeModule extends RuntimeModule {
      constructor() {
        super('rstest runtime');
      }

      override generate() {
        // Rstest runtime code should be prefixed with `rstest_` to avoid conflicts with other runtimes.
        return `
if (typeof __webpack_require__ === 'undefined') {
  return;
}

const originalRequire = __webpack_require__;
__webpack_require__ = function(...args) {
  try {
    console.log('👎1', ...args)
    return originalRequire(...args);
  } catch (e) {
    const errMsg = e.message ?? e.toString();
    console.log('👎2', errMsg)
    if (errMsg.includes('__webpack_modules__[moduleId] is not a function')) {
      throw new Error(\`[Rstest] Cannot find module! '\${args[0]}'\`)
    }
    throw e;
  }
};

Object.keys(originalRequire).forEach(key => {
  __webpack_require__[key] = originalRequire[key];
});

__webpack_require__.rstest_original_modules = {};

__webpack_require__.rstest_reset_modules = () => {
  const mockedIds = Object.keys(__webpack_require__.rstest_original_modules)
  Object.keys(__webpack_module_cache__).forEach(id => {
    // Do not reset mocks registry.
    if (!mockedIds.includes(id)) {
      delete __webpack_module_cache__[id];
    }
  });
}

__webpack_require__.rstest_unmock = (id) => {
  delete __webpack_module_cache__[id]
}

__webpack_require__.rstest_require_actual = __webpack_require__.rstest_import_actual = (id) => {
  const originalModule = __webpack_require__.rstest_original_modules[id];
  // Use fallback module if the module is not mocked.
  const fallbackMod = __webpack_require__(id);
  return originalModule ? originalModule : fallbackMod;
}

__webpack_require__.rstest_exec = async (id, modFactory) => {
console.log('👮‍♀️ exec')
  if (__webpack_module_cache__) {
    let asyncFactory = __webpack_module_cache__[id];
    if (asyncFactory && asyncFactory.constructor.name === 'AsyncFunction') {
      await asyncFactory();
    }
  }
};

__webpack_require__.rstest_mock = (id, modFactory) => {
console.log('😩 rstest_mock', id)
  let requiredModule = undefined
  try {
    requiredModule = __webpack_require__(id);
  } catch {
    // TODO: non-resolved module
  } finally {
    __webpack_require__.rstest_original_modules[id] = requiredModule;
  }
  if (typeof modFactory === 'string' || typeof modFactory === 'number') {
    __webpack_module_cache__[id] = { exports: __webpack_require__(modFactory) };
  } else if (typeof modFactory === 'function') {
    if (modFactory.constructor.name === 'AsyncFunction') {
      __webpack_module_cache__[id] = async () => {
        const exports = await modFactory();
        __webpack_require__.r(exports);
        __webpack_module_cache__[id] = { exports, id, loaded: true };
      }
    } else {
      const exports = modFactory();
      __webpack_require__.r(exports);
      __webpack_module_cache__[id] = { exports, id, loaded: true };
    }
  }
};

__webpack_require__.rstest_do_mock = (id, modFactory) => {
  let requiredModule = undefined
  try {
    requiredModule = __webpack_require__(id);
  } catch {
    // TODO: non-resolved module
  } finally {
    __webpack_require__.rstest_original_modules[id] = requiredModule;
  }
  if (typeof modFactory === 'string' || typeof modFactory === 'number') {
    __webpack_module_cache__[id] = { exports: __webpack_require__(modFactory) };
  } else if (typeof modFactory === 'function') {
    const exports = modFactory();
    __webpack_require__.r(exports);
    __webpack_module_cache__[id] = { exports, id, loaded: true };
  }
};

`;
      }
    }

    compiler.hooks.thisCompilation.tap('CustomPlugin', (compilation) => {
      compilation.hooks.additionalTreeRuntimeRequirements.tap(
        'CustomPlugin',
        (chunk) => {
          compilation.addRuntimeModule(chunk, new RetestImportRuntimeModule());
        },
      );
    });
  }
}

export const pluginMockRuntime: RsbuildPlugin = {
  name: 'rstest:mock-runtime',
  setup: (api) => {
    api.modifyRspackConfig(async (config) => {
      config.plugins!.push(new MockRuntimeRspackPlugin());
    });
  },
};
