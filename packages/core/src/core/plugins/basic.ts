import type { RsbuildPlugin } from '@rsbuild/core';
import path from 'pathe';
import type { RstestContext } from '../../types';
import { TEMP_RSTEST_OUTPUT_DIR } from '../../utils';

export const RUNTIME_CHUNK_NAME = 'runtime';

export const pluginBasic: (context: RstestContext) => RsbuildPlugin = (
  context,
) => ({
  name: 'rstest:basic',
  setup: (api) => {
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
          rootPath,
          name: projectName,
        } = context.projects.find((p) => p.environmentName === name)!;
        return mergeEnvironmentConfig(
          config,
          {
            performance,
            tools,
            resolve,
            source,
            output,
            dev: {
              ...dev,
              progressBar:
                dev?.progressBar === true
                  ? {
                      id: projectName,
                    }
                  : dev?.progressBar,
            },
          },
          {
            source: {
              define: {
                'import.meta.rstest': "global['@rstest/core']",
              },
            },
            output: {
              // Pass resources to the worker on demand according to entry
              manifest: `${name}-manifest.json`,
              sourceMap: {
                js: 'source-map',
              },
              distPath: {
                root:
                  context.projects.length > 1
                    ? `${TEMP_RSTEST_OUTPUT_DIR}/${name}`
                    : TEMP_RSTEST_OUTPUT_DIR,
              },
            },
            tools: {
              rspack: (config, { isProd, rspack }) => {
                config.context = rootPath;
                // treat `test` as development mode
                config.mode = isProd ? 'production' : 'development';
                config.output ??= {};
                config.output.iife = false;
                // polyfill interop
                config.output.importFunctionName = '__rstest_dynamic_import__';
                config.output.devtoolModuleFilenameTemplate =
                  '[absolute-resource-path]';
                config.plugins.push(
                  new rspack.experiments.RstestPlugin({
                    injectModulePathName: true,
                    importMetaPathName: true,
                    hoistMockModule: true,
                    manualMockRoot: path.resolve(rootPath, '__mocks__'),
                  }),
                );

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
                };

                config.resolve ??= {};
                config.resolve.extensions ??= [];
                config.resolve.extensions.push('.cjs');

                // TypeScript allows importing TS files with `.js` extension
                config.resolve.extensionAlias ??= {};
                config.resolve.extensionAlias['.js'] = ['.js', '.ts', '.tsx'];
                config.resolve.extensionAlias['.jsx'] = ['.jsx', '.tsx'];

                if (testEnvironment === 'node') {
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
