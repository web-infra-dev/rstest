import inspector from 'node:inspector';
import type { RsbuildPlugin } from '@rsbuild/core';

const enable = inspector.url() !== undefined;

export const pluginInspect: () => RsbuildPlugin | null = () =>
  enable
    ? {
        name: 'rstest:inspect',
        setup: (api) => {
          api.modifyRspackConfig(async (config) => {
            config.devtool = 'inline-source-map';
            config.optimization ??= {};
            config.optimization.splitChunks = {
              ...(config.optimization.splitChunks || {}),
              maxSize: 1024 * 1024,
              chunks: 'all',
            };
          });
        },
      }
    : null;
