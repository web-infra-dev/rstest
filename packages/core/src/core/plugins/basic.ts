import type { RsbuildPlugin } from '@rsbuild/core';
import path from 'pathe';
import type { RstestContext } from '../../types';
import { TEMP_RSTEST_OUTPUT_DIR } from '../../utils';

export const RUNTIME_CHUNK_NAME = 'runtime';

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
      chain.module.rule(CHAIN_ID.RULE.JS).delete('type');
    });
    api.modifyEnvironmentConfig(
      async (config, { mergeEnvironmentConfig, name }) => {
        const {
          normalizedConfig: {
            resolve,
            source,
            output,
            tools,
            performance,
            dev,
            testEnvironment,
          },
          outputModule,
          rootPath,
        } = context.projects.find((p) => p.environmentName === name)!;
        return mergeEnvironmentConfig(
          config,
          {
            performance,
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
            output: {
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
                root:
                  context.projects.length > 1
                    ? `${TEMP_RSTEST_OUTPUT_DIR}/${name}`
                    : TEMP_RSTEST_OUTPUT_DIR,
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
                config.output.importFunctionName = outputModule
                  ? 'import.meta.__rstest_dynamic_import__'
                  : '__rstest_dynamic_import__';
                config.output.devtoolModuleFilenameTemplate =
                  '[absolute-resource-path]';

                if (!config.devtool || !config.devtool.includes('inline')) {
                  config.devtool = 'nosources-source-map';
                }

                config.plugins.push(
                  new rspack.experiments.RstestPlugin({
                    injectModulePathName: true,
                    importMetaPathName: true,
                    hoistMockModule: true,
                    manualMockRoot: path.resolve(rootPath, '__mocks__'),
                  }),
                );

                config.module.rules ??= [];
                config.module.rules.push({
                  test: /\.mts$/,
                  // Treated mts as strict ES modules.
                  type: 'javascript/esm',
                });

                if (outputModule) {
                  config.plugins.push(
                    new rspack.BannerPlugin({
                      banner: requireShim,
                      // Just before minify stage, to perform tree shaking.
                      stage:
                        rspack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE - 1,
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

                if (testEnvironment.name === 'node') {
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
                config.resolve.byDependency.commonjs.mainFields = [
                  'main',
                  '...',
                ];

                config.optimization = {
                  moduleIds: 'named',
                  chunkIds: 'named',
                  nodeEnv: false,
                  ...(config.optimization || {}),
                  // make sure setup file and test file share the runtime
                  runtimeChunk: {
                    name: `${name}-${RUNTIME_CHUNK_NAME}`,
                  },
                };
              },
            },
          },
        );
      },
    );
  },
});
