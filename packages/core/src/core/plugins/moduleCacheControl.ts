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
// Chunk-local so a reused worker holding several projects' runtime chunks under
// \`isolate: false\` keeps each project's module ids separate.
var __rstest_setup_ids__ = [];
var __rstest_test_entry_ids__ = Object.create(null);

__webpack_require__.rstest_register_setup_id = (id) => {
  __rstest_setup_ids__.push(id);
};

__webpack_require__.rstest_register_test_entry_id = (path, id) => {
  __rstest_test_entry_ids__[path] = id;
};

function __rstest_clean_module_cache__(testEntryPath) {
  if (typeof __webpack_require__ === 'undefined') {
    return;
  }
  delete __webpack_module_cache__['@rstest/core'];

  __rstest_setup_ids__.forEach((id) => {
    delete __webpack_module_cache__[id];
  });
  __rstest_setup_ids__.length = 0;

  var testEntryId = __rstest_test_entry_ids__[testEntryPath];
  if (testEntryId !== undefined) {
    delete __webpack_module_cache__[testEntryId];
  }
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
 * Clean setup, current test entry, and Rstest module caches manually.
 *
 * Setup files are re-executed for every test file. A test entry is invalidated
 * only when it is about to run as the current entry, so an in-source module
 * imported by regular tests otherwise preserves its once-per-worker state.
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

    const isTestEntryPath = (resourcePath: string) => {
      for (const testEntryPaths of testEntryPathState.values()) {
        if (testEntryPaths.has(resourcePath)) {
          return true;
        }
      }
      return false;
    };

    // Rstest paths are posix-style (pathe), but rspack matches `test`
    // against the native resource path, which uses `\` on Windows — a raw
    // string/array `test` would never match there, so the cache registration
    // below would not be injected. Compare paths normalized to posix instead.
    api.transform(
      {
        test: (resourcePath) => {
          const normalizedPath = path.normalize(resourcePath);
          return (
            getSetupFileSet().has(normalizedPath) ||
            isTestEntryPath(normalizedPath)
          );
        },
      },
      ({ code, resourcePath }) => {
        const normalizedPath = path.normalize(resourcePath);
        const registration = getSetupFileSet().has(normalizedPath)
          ? `if (__webpack_require__.rstest_register_setup_id && __webpack_module__.id != null) {
  __webpack_require__.rstest_register_setup_id(__webpack_module__.id);
}`
          : `if (__webpack_require__.rstest_register_test_entry_id && __webpack_module__.id != null) {
  __webpack_require__.rstest_register_test_entry_id(${JSON.stringify(normalizedPath)}, __webpack_module__.id);
}`;

        return {
          code: `${code}\n${registration}`,
        };
      },
    );

    api.modifyRspackConfig((config) => {
      config.plugins.push(new RstestCacheControlPlugin());
    });
  },
});
