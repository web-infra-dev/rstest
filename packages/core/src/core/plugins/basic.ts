import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RsbuildPlugin } from '@rsbuild/core';
import pathe from 'pathe';
import {
  importMetaHook,
  RSTEST_DYNAMIC_IMPORT_HOOK,
  RSTEST_REQUIRE_RESOLVE_HOOK,
} from '../../runtime/worker/runtimeHooks';
import type { RstestContext } from '../../types';
import { getTempRstestOutputDir, resolveProjectBuildCache } from '../../utils';
import { runtimeChunkNameForEnvironment } from '../runtimeChunk';
import { isNodeLikeTestEnvironment } from '../testEnvironment';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const requireShim = `// Rstest ESM shims
import __rstest_shim_module__ from 'node:module';
const require = /*#__PURE__*/ __rstest_shim_module__.createRequire(import.meta.url);
`;

export const pluginBasic: (context: RstestContext) => RsbuildPlugin = (
  context,
) => ({
  name: 'rstest:basic',
  setup: (api) => {
    api.modifyBundlerChain((chain, { CHAIN_ID }) => {
      // Rsbuild sets splitChunks to false for the node target.
      // Use modifyBundlerChain to re-enable it so users can override it.
      chain.optimization.splitChunks({ chunks: 'all' });

      // Port https://github.com/web-infra-dev/rsbuild/pull/5955 before it merged into Rsbuild.
      // Use Rspack default behavior
      chain.module
        .rule(CHAIN_ID.RULE.JS)
        .oneOf(CHAIN_ID.ONE_OF.JS_MAIN)
        .delete('type');
    });
    api.modifyEnvironmentConfig((config, { mergeEnvironmentConfig, name }) => {
      const outputDistPathRoot = context.normalizedConfig.output.distPath.root;
      const project = context.projects.find((p) => p.environmentName === name)!;
      const {
        normalizedConfig: {
          resolve,
          source,
          output,
          tools,
          dev,
          testEnvironment,
        },
        outputModule,
        rootPath,
      } = project;

      const distRootDir = getTempRstestOutputDir({
        distPathRoot: outputDistPathRoot,
        environmentName: name,
        multipleProjects: context.projects.length > 1,
      });

      // Mirrors the pattern in packages/browser/src/hostController.ts:
      // only write `performance.buildCache` when the user has opted in.
      // Leaving it undefined keeps the generated Rsbuild config aligned with
      // the user's original intent instead of materializing the default value.
      const buildCache = resolveProjectBuildCache({
        context,
        project,
      });

      return mergeEnvironmentConfig(
        config,
        {
          performance: buildCache ? { buildCache } : undefined,
          tools,
          resolve,
          source,
          output,
          dev,
        },
        {
          source: {
            define: {
              'import.meta.rstest': "global['@rstest/core']",
              'import.meta.env': 'process.env',
            },
          },
          resolve: {
            // Extend the default resolve conditionNames for browser-like environment, use `browser` field instead of `node` field
            conditionNames:
              isNodeLikeTestEnvironment(testEnvironment) ||
              resolve?.conditionNames
                ? undefined
                : ['browser', '...'],
          },
          output: {
            assetPrefix: '',
            // Pass resources to the worker on demand according to entry
            manifest: `${name}-manifest.json`,
            sourceMap: {
              js: 'source-map',
            },
            module: outputModule,
            filename: outputModule
              ? {
                  js: '[name].mjs',
                }
              : undefined,
            distPath: {
              root: distRootDir,
            },
          },
          tools: {
            rspack: (config, { isProd, rspack }) => {
              // keep windows path as native path
              config.context = path.resolve(rootPath);
              // treat `test` as development mode
              config.mode = isProd ? 'production' : 'development';
              config.output ??= {};
              config.output.iife = false;
              // polyfill interop
              // TODO: if we ever expose `output.importFunctionName` as a user
              // option, rspack#13849's rewrite still reads it directly to pick
              // the callee for non-string-literal `import()`. Either bind the
              // runtime helper under the user-configured name as well, or move
              // the dynamic-import-origin rewrite onto a dedicated rspack
              // option so the two concerns stop sharing one identifier.
              config.output.importFunctionName = outputModule
                ? importMetaHook(RSTEST_DYNAMIC_IMPORT_HOOK)
                : RSTEST_DYNAMIC_IMPORT_HOOK;
              config.output.devtoolModuleFilenameTemplate =
                '[absolute-resource-path]';

              if (
                typeof config.devtool !== 'string' ||
                !config.devtool.includes('inline')
              ) {
                config.devtool = 'nosources-source-map';
              }

              const rstestPluginOptions = {
                injectModulePathName: true,
                importMetaPathName: true,
                hoistMockModule: true,
                manualMockRoot: pathe.resolve(rootPath, '__mocks__'),
                // The runtime hook below resolves relative dynamic-import
                // specifiers against the source module that produced the
                // call, instead of the test entry, fixing #1207.
                injectDynamicImportOrigin: true,
                // The runtime hook below resolves relative require.resolve
                // specifiers against the source module that produced the
                // call, instead of the test entry, fixing #848.
                injectRequireResolveOrigin: {
                  functionName: outputModule
                    ? importMetaHook(RSTEST_REQUIRE_RESOLVE_HOOK)
                    : RSTEST_REQUIRE_RESOLVE_HOOK,
                },
              };

              config.plugins.push(
                new rspack.experiments.RstestPlugin(rstestPluginOptions),
              );

              config.module.rules ??= [];
              config.module.rules.push({
                test: /\.mts$/,
                // Treated mts as strict ES modules.
                type: 'javascript/esm',
              });

              // Disable rspack's built-in `webassembly/async` handling and turn
              // every `.wasm` into a self-contained JS module via wasmLoader.mjs
              // that reads its on-disk SOURCE bytes and instantiates them, so
              // there is no `async_wasm_loading` runtime and no `readFile(`
              // string-replace. All wasm reads resolve source-relative (#1455).
              config.experiments ??= {};
              config.experiments.asyncWebAssembly = false;
              config.module.rules.push({
                test: /\.wasm$/,
                type: 'javascript/auto',
                use: [path.resolve(__dirname, './wasmLoader.mjs')],
              });

              if (outputModule) {
                config.plugins.push(
                  new rspack.BannerPlugin({
                    banner: requireShim,
                    // Just before minify stage, to perform tree shaking.
                    stage: rspack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE - 1,
                    raw: true,
                    include: /\.(js|mjs)$/,
                  }),
                );
              }

              config.module.parser ??= {};
              config.module.parser.javascript = {
                // Keep dynamic import expressions.
                // eg. (modulePath) => import(modulePath)
                importDynamic: false,
                // Keep dynamic require expressions.
                // eg. (modulePath) => require(modulePath)
                requireDynamic: false,
                requireAsExpression: false,
                // Keep require.resolve expressions.
                requireResolve: false,
                // Keep `new URL(<literal>, import.meta.url)` expressions instead
                // of rewriting them into hashed bundled asset paths. Tests run
                // against on-disk source, so this must resolve at runtime
                // relative to the source module (Node/Vitest behavior), see #1455.
                // Load-bearing for ALL URL-based source-relative reads (assets
                // and the `new URL(...).href` wasm path), not just #1455's
                // sibling case; re-enabling `url` re-breaks every one of them.
                url: false,
                ...(config.module.parser.javascript || {}),
                // suppress ESModulesLinkingError for exports that might be implemented in mock
                exportsPresence: 'warn',
              };

              config.resolve ??= {};
              config.resolve.extensions ??= [];
              config.resolve.extensions.push('.cjs');

              // TypeScript allows importing TS files with `.js` extension
              config.resolve.extensionAlias ??= {};
              config.resolve.extensionAlias['.js'] = ['.js', '.ts', '.tsx'];
              config.resolve.extensionAlias['.jsx'] = ['.jsx', '.tsx'];

              if (isNodeLikeTestEnvironment(testEnvironment)) {
                // skip `module` field in Node.js environment.
                // ESM module resolved by module field is not always a native ESM module
                config.resolve.mainFields = config.resolve.mainFields?.filter(
                  (filed) => filed !== 'module',
                ) || ['main'];
              }

              config.resolve.byDependency ??= {};
              config.resolve.byDependency.commonjs ??= {};
              // skip `module` field when commonjs require
              // By default, rspack resolves the "module" field for commonjs first, but this is not always returned synchronously in esm
              config.resolve.byDependency.commonjs.mainFields = ['main', '...'];

              config.optimization = {
                moduleIds: 'named',
                chunkIds: 'named',
                nodeEnv: false,
                ...(config.optimization || {}),
                // make sure setup file and test file share the runtime
                runtimeChunk: {
                  name: runtimeChunkNameForEnvironment(name),
                },
              };
            },
          },
        },
      );
    });
  },
});
