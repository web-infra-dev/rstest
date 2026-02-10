import inspector from 'node:inspector';
import type { RsbuildPlugin } from '@rsbuild/core';

/**
 * Check if inspect mode is enabled based on:
 * 1. Current process is being inspected (inspector.url() !== undefined)
 * 2. pool.execArgv contains --inspect flags (for worker debugging)
 */
const hasInspectFlag = (execArgv?: string[]) =>
  execArgv?.some((arg) => arg.startsWith('--inspect')) ?? false;

export const pluginInspect: (options?: {
  poolExecArgv?: string[];
}) => RsbuildPlugin | null = (options) => {
  const enable =
    inspector.url() !== undefined || hasInspectFlag(options?.poolExecArgv);

  return enable
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
};
