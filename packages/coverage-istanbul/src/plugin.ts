import { createRequire } from 'node:module';
import type { NormalizedCoverageOptions, RsbuildPlugin } from '@rstest/core';

const require = createRequire(import.meta.url);

export const pluginCoverage: (
  options: NormalizedCoverageOptions,
) => RsbuildPlugin = (options) => ({
  name: 'rstest:coverage',
  setup: (api) => {
    api.modifyEnvironmentConfig((config, { mergeEnvironmentConfig }) => {
      const swcPluginPath = require.resolve('swc-plugin-coverage-instrument');

      return mergeEnvironmentConfig(config, {
        tools: {
          swc: {
            jsc: {
              experimental: {
                plugins: [
                  [
                    swcPluginPath,
                    {
                      unstableExclude: options.exclude,
                    },
                  ],
                ],
              },
            },
          },
        },
      });
    });
  },
});
