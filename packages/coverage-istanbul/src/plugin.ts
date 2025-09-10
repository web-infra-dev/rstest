import { createRequire } from 'node:module';
import type { RsbuildPlugin } from '@rstest/core';

const require = createRequire(import.meta.url);

export const pluginCoverage: () => RsbuildPlugin = () => ({
  name: 'rstest:coverage',
  setup: (api) => {
    api.modifyRspackConfig((config) => {
      const swcPluginPath = require.resolve('swc-plugin-coverage-instrument');

      config.module.rules ??= [];
      config.module.rules.push({
        test: /\.(js|ts)$/,
        // TODO: exclude test files.
        exclude: [/node_modules/],
        loader: 'builtin:swc-loader',
        options: {
          jsc: {
            parser: {
              syntax: 'typescript',
            },
            experimental: {
              plugins: [[swcPluginPath, {}]],
            },
          },
        },
        type: 'javascript/auto',
      });
    });
  },
});
