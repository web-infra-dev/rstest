import inspector from 'node:inspector';
import type { RsbuildPlugin } from '@rsbuild/core';

const enable = inspector.url() !== undefined;

export const pluginInspect: () => RsbuildPlugin | null = () =>
  enable
    ? {
        name: 'rstest:inspect',
        setup: (api) => {
          api.modifyRspackConfig(async (config) => {
            // use inline source map or write to disk
            config.devtool = 'inline-nosources-source-map';
            config.optimization ??= {};
            config.optimization.splitChunks = {
              ...(config.optimization.splitChunks || {}),
              // Limit the size of each chunk to speed up the source map loading in inspector
              maxSize: 1024 * 1024, // 1MB
              chunks: 'all',
            };
          });
        },
      }
    : null;
