import type { ModifyRspackConfigUtils, Rspack } from '@rsbuild/core';
import pathe from 'pathe';
import { castArray, logger } from '../../utils';
import { RSTEST_API_GLOBAL_KEY } from '../../utils/constants';

export type RstestBuildTarget = 'node' | 'web';

type RspackInstance = ModifyRspackConfigUtils['rspack'];

/**
 * The `import.meta.rstest` define text for each executor. The node form is
 * byte-identical to the historical inline literal in `pluginBasic`; the web
 * form reads the same key off `globalThis`, which the browser client entry
 * assigns per test file before test modules evaluate.
 *
 * Define replacement only matches plain member access: an optional-chained
 * `import.meta.rstest?.x` is left to the bundler's `import.meta` folding and
 * evaluates to `undefined`.
 */
export const importMetaRstestDefine = (target: RstestBuildTarget): string =>
  target === 'node'
    ? `global['${RSTEST_API_GLOBAL_KEY}']`
    : `globalThis['${RSTEST_API_GLOBAL_KEY}']`;

/**
 * The native `RstestPlugin` guards the node chunk-install runtime so a late
 * chunk install cannot overwrite a mocked module id with the real factory,
 * but it does not patch the web (jsonp) chunk loading runtime. This plugin
 * mirrors the exact guard for web builds: without it, a lazy-loaded test
 * chunk that bundles its own copy of a module mocked earlier in the page
 * (e.g. by a setup file) would clobber the installed mock factory.
 */
const CHUNK_INSTALL_LOOP_PATTERNS = [
  'for (var moduleId in moreModules) {',
  'for (moduleId in moreModules) {',
] as const;

const MOCKED_ID_INSTALL_GUARD =
  'if (Object.keys(__webpack_require__.rstest_original_modules || {}).includes(moduleId) || Object.keys(__webpack_require__.rstest_original_module_factories || {}).includes(moduleId)) continue;';

export const injectChunkInstallMockGuard = (code: string): string => {
  let patched = code;
  for (const pattern of CHUNK_INSTALL_LOOP_PATTERNS) {
    patched = patched
      .split(pattern)
      .join(`${pattern}\n${MOCKED_ID_INSTALL_GUARD}`);
  }
  return patched;
};

class WebMockChunkInstallGuardPlugin {
  apply(compiler: Rspack.Compiler): void {
    const PLUGIN_NAME = 'RstestWebMockChunkInstallGuardPlugin';
    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation) => {
      compilation.hooks.runtimeModule.tap(PLUGIN_NAME, (module) => {
        const source = module.source;
        if (!source) {
          return;
        }
        const code = source.source.toString();
        // Only the chunk-install runtime iterates `moreModules`; skip the
        // scan-and-rebuild for every other runtime module.
        if (!code.includes('moreModules')) {
          return;
        }
        const patched = injectChunkInstallMockGuard(code);
        if (patched === code) {
          // A chunk-install runtime that matches no known loop header means
          // rspack changed the generated text and the guard silently lapsed.
          logger.debug(
            `${PLUGIN_NAME}: chunk-install runtime matched no known loop header; late chunk installs may clobber mocked modules`,
          );
          return;
        }
        source.source = Buffer.from(patched, 'utf-8');
      });
    });
  }
}

export interface MockRstestPluginOptions {
  injectModulePathName: true;
  importMetaPathName: true;
  hoistMockModule: true;
  manualMockRoot: string;
}

/**
 * The target-agnostic core of `rspack.experiments.RstestPlugin` options.
 * The node build spreads this and adds its pool-interop extras
 * (`injectDynamicImportOrigin` / `injectRequireResolveOrigin`); the web build
 * uses it as-is.
 */
export const getMockRstestPluginOptions = (options: {
  rootPath: string;
}): MockRstestPluginOptions => ({
  injectModulePathName: true,
  importMetaPathName: true,
  hoistMockModule: true,
  manualMockRoot: pathe.resolve(options.rootPath, '__mocks__'),
});

/**
 * The `@rstest/core` external that routes test-file imports of the API
 * package to the runtime-published global. Shared by the node build
 * (`pluginExternal`) and the web mock build so the wire contract cannot
 * drift; under `target: 'web'` the `global` external compiles to a
 * `self['@rstest/core']` read.
 */
export const rstestCoreGlobalExternal: Record<string, string> = {
  [RSTEST_API_GLOBAL_KEY]: `global ${RSTEST_API_GLOBAL_KEY}`,
};

/**
 * Mock factories may add exports the real module lacks; downgrade
 * ESModulesLinkingError to a warning wherever the mock transform runs.
 */
export const applyMockExportsPresence = (
  config: Rspack.Configuration,
): void => {
  config.module ??= {};
  config.module.parser ??= {};
  config.module.parser.javascript = {
    ...(config.module.parser.javascript || {}),
    exportsPresence: 'warn',
  };
};

/**
 * Web parameterization of the mock transform. Registers `RstestPlugin` with
 * the base options, keeps `@rstest/core` external against the runtime API
 * global, and enables `exportsPresence: 'warn'` (mock factories may add
 * exports the real module lacks).
 *
 * Deliberately excludes every node-pool piece: `importFunctionName`,
 * `injectDynamicImportOrigin`, `injectRequireResolveOrigin`, the require
 * shim banner, `devtool`, and the `'import.meta.env'` -> `process.env`
 * define.
 */
export const applyWebMockRspackConfig = (
  config: Rspack.Configuration,
  options: { rspack: RspackInstance; rootPath: string },
): void => {
  config.plugins ??= [];
  config.plugins.push(
    new options.rspack.experiments.RstestPlugin(
      getMockRstestPluginOptions({ rootPath: options.rootPath }),
    ),
    new WebMockChunkInstallGuardPlugin(),
  );

  // The hoister emits hoisted `rs.mock`/`rs.hoisted` blocks above bundled
  // module imports, so an aliased-in `@rstest/core` provider module would be
  // required *after* an eager `rs.hoisted` callback runs. Keeping the request
  // external against the runtime API global preserves provider ordering.
  config.externals = castArray(config.externals);
  config.externals.unshift(rstestCoreGlobalExternal);

  applyMockExportsPresence(config);
};
