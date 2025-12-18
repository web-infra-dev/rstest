import type { RsbuildPlugin, Rspack } from '@rsbuild/core';

class RstestCacheControlPlugin {
  apply(compiler: Rspack.Compiler) {
    const { RuntimeModule } = compiler.webpack;
    class RetestCacheControlModule extends RuntimeModule {
      constructor() {
        super('rstest_cache_control');
      }

      override generate() {
        return `
global.setupIds = [];

function __rstest_clean_core_cache__() {
  if (typeof __webpack_require__ === 'undefined') {
    return;
  }
  delete __webpack_module_cache__['@rstest/core'];

  global.setupIds.forEach((id) => {
    delete __webpack_module_cache__[id];
  });
}

global.__rstest_clean_core_cache__ = __rstest_clean_core_cache__;
`;
      }
    }

    compiler.hooks.thisCompilation.tap(
      'RstestCacheControlPlugin',
      (compilation) => {
        compilation.hooks.additionalTreeRuntimeRequirements.tap(
          'RstestAddCacheControlRuntimePlugin',
          (chunk) => {
            compilation.addRuntimeModule(chunk, new RetestCacheControlModule());
          },
        );
      },
    );
  }
}

/**
 * clean setup and rstest module cache manually
 *
 * This is used to ensure that the setup files and rstest core are re-executed in each test run
 *
 * By default, modules are isolated between different tests (powered by tinypool).
 */
export const pluginCacheControl: (setupFiles: string[]) => RsbuildPlugin = (
  setupFiles: string[],
) => ({
  name: 'rstest:cache-control',
  setup: (api) => {
    if (setupFiles.length === 0) {
      return;
    }
    api.transform({ test: setupFiles }, ({ code }) => {
      // register setup's moduleId
      return {
        code: `
          ${code}
         if (global.setupIds && __webpack_module__.id) {
  global.setupIds.push(__webpack_module__.id);
}
        `,
      };
    });
    api.modifyRspackConfig(async (config) => {
      config.plugins.push(new RstestCacheControlPlugin());
    });
  },
});
