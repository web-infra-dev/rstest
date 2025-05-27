import type { RsbuildPlugin, Rspack } from '@rsbuild/core';

class MockRuntimeRspackPlugin {
  apply(compiler: Rspack.Compiler) {
    const { RuntimeModule } = compiler.webpack;
    class RetestImportRuntimeModule extends RuntimeModule {
      constructor() {
        super('rstest runtime');
      }

      override generate() {
        return `
if (typeof __webpack_require__ === 'undefined') {
  return;
}

__webpack_require__.before_mocked_modules = {};

__webpack_require__.reset_modules = () => {
  __webpack_module_cache__ = {};
}

__webpack_require__.unmock = (id) => {
  delete __webpack_module_cache__[id]
}

__webpack_require__.require_actual = __webpack_require__.import_actual = (id) => {
  const beforeMock = __webpack_require__.before_mocked_modules[id];
  // Use fallback module if the module is not mocked.
  const fallbackMod = __webpack_require__(id);
  return beforeMock ? beforeMock : fallbackMod;
}

__webpack_require__.set_mock = (id, modFactory) => {
  try {
    __webpack_require__.before_mocked_modules[id] = __webpack_require__(id);
  } catch {
    // TODO: non-resolved module
  }
  if (typeof modFactory === 'string' || typeof modFactory === 'number') {
    __webpack_module_cache__[id] = { exports: __webpack_require__(modFactory) };
  } else if (typeof modFactory === 'function') {
    __webpack_module_cache__[id] = { exports: modFactory() };
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
