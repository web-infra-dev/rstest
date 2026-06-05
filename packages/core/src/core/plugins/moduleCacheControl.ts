import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
import path from 'pathe';

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
 * By default, modules are isolated between different tests (each test runs in
 * a fresh worker process spawned by rstest's pool).
 */
export const pluginCacheControl: (setupFiles: string[]) => RsbuildPlugin = (
  setupFiles: string[],
) => ({
  name: 'rstest:cache-control',
  setup: (api) => {
    if (setupFiles.length) {
      // `setupFiles` are posix-style paths (pathe), but rspack matches `test`
      // against the native resource path, which uses `\` on Windows — a raw
      // string/array `test` would never match there, so the `setupIds` marker
      // below would not be injected and setup files would stop re-running per
      // file under `isolate: false`. Compare paths normalized to posix instead.
      const setupFileSet = new Set(
        setupFiles.map((file) => path.normalize(file)),
      );
      api.transform(
        {
          test: (resourcePath) =>
            setupFileSet.has(path.normalize(resourcePath)),
        },
        ({ code }) => {
          // register setup's moduleId
          return {
            code: `${code}
         if (global.setupIds && __webpack_module__.id) {
  global.setupIds.push(__webpack_module__.id);
}
        `,
          };
        },
      );
    }

    api.modifyRspackConfig((config) => {
      config.plugins.push(new RstestCacheControlPlugin());
    });
  },
});
