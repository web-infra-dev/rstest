import { createRequire } from 'node:module';
import type { NormalizedCoverageOptions, RsbuildPlugin } from '@rstest/core';

type TransformCoverageFn = (
  code: string,
  filename: string,
) => Promise<{ code: string; map?: any }>;

const transformCoverageFns: Record<string, TransformCoverageFn> = {};

const transformCoverage = async (
  environmentName: string,
  code: string,
  filename: string,
): ReturnType<TransformCoverageFn> => {
  if (!transformCoverageFns[environmentName]) {
    throw new Error(
      `Can not transform coverage since swc transform function for ${environmentName} is not registered`,
    );
  }
  return transformCoverageFns[environmentName](code, filename);
};

export { transformCoverage };

export const pluginCoverage: (
  options: NormalizedCoverageOptions,
) => RsbuildPlugin = (options) => ({
  name: 'rstest:coverage',
  setup: (api) => {
    api.modifyEnvironmentConfig((config, { mergeEnvironmentConfig }) => {
      const require = createRequire(import.meta.url);

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
      handler: (chain, { rspack, CHAIN_ID, environment }) => {
        const { rspackExperiments: _rspackExperiments, ...swcOptions } =
          chain.module
            .rule(CHAIN_ID.RULE.JS)
            .use(CHAIN_ID.USE.SWC)
            .get('options') || {};

        transformCoverageFns[environment.name] = async (
          code: string,
          filename: string,
        ) =>
          rspack.experiments.swc.transform(code, {
            ...swcOptions,
            filename,
          });
      },
      order: 'post',
    });

    api.onExit(() => {
      Object.assign(transformCoverageFns, {});
    });
  },
});
