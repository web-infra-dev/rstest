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
// Per-chunk setup module ids. Chunk-local (not a shared \`global.setupIds\`) so a
// reused worker holding several projects' runtime chunks under \`isolate: false\`
// keeps each project's ids separate — a sibling chunk's evaluation can no longer
// reset them. Setup modules register through this chunk's own \`__webpack_require__\`.
var __rstest_setup_ids__ = [];

__webpack_require__.rstest_register_setup_id = (id) => {
  __rstest_setup_ids__.push(id);
};

function __rstest_clean_core_cache__() {
  if (typeof __webpack_require__ === 'undefined') {
    return;
  }
  delete __webpack_module_cache__['@rstest/core'];

  __rstest_setup_ids__.forEach((id) => {
    delete __webpack_module_cache__[id];
  });
  // Setup modules re-register on their next per-file load, so reset to keep the
  // list from growing across every file this kept chunk serves.
  __rstest_setup_ids__.length = 0;
}

// Register this chunk's self-scoped cleaner instead of overwriting a single
// \`global.__rstest_clean_core_cache__\` slot. Under \`isolate: false\` one reused
// worker can keep multiple projects' runtime chunks alive at once (see
// \`keptRuntimeChunks\`); a single global slot is last-writer-wins, so the worker
// would clean the last-evaluated project's cache before every file. Each cleaner
// only touches its own \`__webpack_module_cache__\`, so the worker can safely
// invoke them all per file.
(global.__rstest_cache_cleaners__ ??= new Set()).add(__rstest_clean_core_cache__);
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
export const pluginCacheControl: (
  getSetupFiles: () => string[],
) => RsbuildPlugin = (getSetupFiles) => ({
  name: 'rstest:cache-control',
  setup: (api) => {
    let setupFileSet: Set<string> | undefined;
    const getSetupFileSet = () => {
      setupFileSet ??= new Set(
        getSetupFiles().map((file) => path.normalize(file)),
      );
      return setupFileSet;
    };

    // `setupFiles` are posix-style paths (pathe), but rspack matches `test`
    // against the native resource path, which uses `\` on Windows — a raw
    // string/array `test` would never match there, so the setup-id registration
    // below would not be injected and setup files would stop re-running per
    // file under `isolate: false`. Compare paths normalized to posix instead.
    api.transform(
      {
        test: (resourcePath) =>
          getSetupFileSet().has(path.normalize(resourcePath)),
      },
      ({ code }) => {
        // Register via this chunk's own `__webpack_require__` (not a shared
        // `global.setupIds`) so each project's setup ids stay isolated under
        // `isolate: false`.
        return {
          code: `${code}
if (__webpack_require__.rstest_register_setup_id && __webpack_module__.id) {
  __webpack_require__.rstest_register_setup_id(__webpack_module__.id);
}
        `,
        };
      },
    );

    api.modifyRspackConfig((config) => {
      config.plugins.push(new RstestCacheControlPlugin());
    });
  },
});
