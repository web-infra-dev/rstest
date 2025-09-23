import { createRequire } from 'node:module';
import type { NormalizedCoverageOptions, RsbuildPlugin } from '@rstest/core';

const require = createRequire(import.meta.url);

let transformCoverageFn:
  | ((code: string, filename: string) => Promise<{ code: string; map?: any }>)
  | undefined;

const transformCoverage: NonNullable<typeof transformCoverageFn> = async (
  code,
  filename,
) => {
  if (!transformCoverageFn) {
    throw new Error(
      'can not transform coverage since swc transform function is not registered',
    );
  }
  return transformCoverageFn(code, filename);
};

export { transformCoverage };

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

    api.modifyBundlerChain({
      handler: (chain, { rspack, CHAIN_ID }) => {
        const { rspackExperiments: _rspackExperiments, ...swcOptions } =
          chain.module
            .rule(CHAIN_ID.RULE.JS)
            .use(CHAIN_ID.USE.SWC)
            .get('options') || {};

        transformCoverageFn = async (code: string, filename: string) =>
          rspack.experiments.swc.transform(code, {
            ...swcOptions,
            filename,
          });
      },
      order: 'post',
    });

    api.onExit(() => {
      transformCoverageFn = undefined;
    });
  },
});
