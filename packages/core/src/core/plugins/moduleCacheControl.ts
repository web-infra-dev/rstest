import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
import path from 'pathe';

export type TestEntryPathState = Map<string, Set<string>>;

class RstestCacheControlPlugin {
  apply(compiler: Rspack.Compiler) {
    const { RuntimeModule } = compiler.webpack;
    class RetestCacheControlModule extends RuntimeModule {
      constructor() {
        super('rstest_cache_control');
      }

      override generate() {
        return `
// Per-chunk module ids that must re-evaluate for every test file. Chunk-local so
// a reused worker holding several projects' runtime chunks under \`isolate: false\`
// keeps each project's ids separate. These modules register through this
// chunk's own \`__webpack_require__\`.
var __rstest_reload_ids__ = [];

__webpack_require__.rstest_register_reload_id = (id) => {
  __rstest_reload_ids__.push(id);
};

function __rstest_clean_module_cache__() {
  if (typeof __webpack_require__ === 'undefined') {
    return;
  }
  delete __webpack_module_cache__['@rstest/core'];

  __rstest_reload_ids__.forEach((id) => {
    delete __webpack_module_cache__[id];
  });
  // Modules re-register on their next per-file load, so reset to keep the list
  // from growing across every file this kept chunk serves.
  __rstest_reload_ids__.length = 0;
}

// Register this chunk's self-scoped cleaner instead of overwriting a single
// \`global.__rstest_clean_core_cache__\` slot. Under \`isolate: false\` one reused
// worker can keep multiple projects' runtime chunks alive at once (see
// \`keptRuntimeChunks\`); a single global slot is last-writer-wins, so the worker
// would clean the last-evaluated project's cache before every file. Each cleaner
// only touches its own \`__webpack_module_cache__\`, so the worker can safely
// invoke them all per file.
(global.__rstest_cache_cleaners__ ??= new Set()).add(__rstest_clean_module_cache__);
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
 * Clean setup, test entry, and Rstest module caches manually.
 *
 * This ensures setup files and test entries are re-executed for every test file
 * when a worker is reused with `isolate: false`.
 *
 * By default, modules are isolated between different tests (each test runs in
 * a fresh worker process spawned by rstest's pool).
 */
export const pluginCacheControl: (
  getSetupFiles: () => string[],
  testEntryPathState: TestEntryPathState,
) => RsbuildPlugin = (getSetupFiles, testEntryPathState) => ({
  name: 'rstest:cache-control',
  setup: (api) => {
    let setupFileSet: Set<string> | undefined;
    const getSetupFileSet = () => {
      setupFileSet ??= new Set(
        getSetupFiles().map((file) => path.normalize(file)),
      );
      return setupFileSet;
    };

    // Rstest paths are posix-style (pathe), but rspack matches `test`
    // against the native resource path, which uses `\` on Windows — a raw
    // string/array `test` would never match there, so the reload registration
    // below would not be injected and these modules would stop re-running per
    // file under `isolate: false`. Compare paths normalized to posix instead.
    api.transform(
      {
        test: (resourcePath) => {
          const normalizedPath = path.normalize(resourcePath);
          if (getSetupFileSet().has(normalizedPath)) {
            return true;
          }
          for (const testEntryPaths of testEntryPathState.values()) {
            if (testEntryPaths.has(normalizedPath)) {
              return true;
            }
          }
          return false;
        },
      },
      ({ code }) => {
        // Register via this chunk's own `__webpack_require__` (not a shared
        // global list) so each project's reload ids stay isolated under
        // `isolate: false`.
        return {
          code: `${code}
if (__webpack_require__.rstest_register_reload_id && __webpack_module__.id) {
  __webpack_require__.rstest_register_reload_id(__webpack_module__.id);
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
