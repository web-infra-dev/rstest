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
    const require = createRequire(import.meta.url);

    const swcPluginPath = require.resolve('swc-plugin-coverage-instrument');

    api.modifyBundlerChain({
      handler: (chain, { rspack, CHAIN_ID, environment }) => {
        const isV1 = api.context.version.startsWith('1.');
        const jsRule = isV1
          ? chain.module.rule(CHAIN_ID.RULE.JS)
          : chain.module.rule(CHAIN_ID.RULE.JS).oneOf(CHAIN_ID.ONE_OF.JS_MAIN);

        const {
          rspackExperiments: _rspackExperiments,
          collectTypeScriptInfo: _collectTypeScriptInfo,
          ...swcOptions
        } = jsRule.use(CHAIN_ID.USE.SWC).get('options') || {};

        swcOptions.jsc ??= {};
        swcOptions.jsc.experimental ??= {};
        swcOptions.jsc.experimental.plugins ??= [];

        // only apply coverage instrument plugin for main JS rule
        swcOptions.jsc.experimental.plugins.push([
          swcPluginPath,
          {
            unstableExclude: options.exclude,
          },
        ]);

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
