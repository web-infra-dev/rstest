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

if (typeof __webpack_module_cache__ !== 'undefined') {
  __webpack_require__.c = __webpack_module_cache__;
}

__webpack_require__.mocked_modules = {};

const unifyNodeProtocol = (id) => {
  if (id.startsWith('node:')) {
    return id.slice(5);
  }
  return id;
};

__webpack_require__.set_mock = (id, modFactory) => {
  if (typeof modFactory === 'string') {
    const mockFromId = modFactory;
    const mockToId = id;
    __webpack_require__.c[mockFromId] = { exports: __webpack_require__(mockToId) };
    __webpack_require__.mocked_modules[mockFromId] = mockToId;
  }

  if(typeof modFactory === 'function') {
    // TODO:
  }

};
__webpack_require__.get_mock = (id) => {
  let currentMock = __webpack_require__.mocked_modules[id];
  if (currentMock) {
    return currentMock;
  }
};
__webpack_require__.rstest_require = (...args) => {
  let currentMock = __webpack_require__.mocked_modules[args[0]];
  if (currentMock) {
    const bypassedId = currentMock.qqq
    const raw = __webpack_require__.mocked_modules[bypassedId]
    if(raw) {
      delete __webpack_require__.mocked_modules[bypassedId]
    }
    const res = currentMock();
    if(raw) {
      __webpack_require__.mocked_modules[bypassedId] = raw
    }
    return res;
  }
  return __webpack_require__(...args)
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
