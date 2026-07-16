import type { RsbuildPlugin, Rspack } from '@rstest/core';

type TransformCoverageFn = (
  code: string,
  filename: string,
) => Promise<{ code: string; map?: string }>;

const transformCoverageFns: Record<string, TransformCoverageFn> = {};

export const transformCoverage = async (
  environmentName: string,
  code: string,
  filename: string,
): ReturnType<TransformCoverageFn> => {
  const transform = transformCoverageFns[environmentName];
  if (!transform) {
    throw new Error(
      `Can not transform coverage since swc transform function for ${environmentName} is not registered`,
    );
  }
  return transform(code, filename);
};

export const pluginCoverage = (): RsbuildPlugin => ({
  name: 'rstest:coverage-v8',
  setup: (api) => {
    api.modifyBundlerChain({
      handler: (chain, { rspack, CHAIN_ID, environment }) => {
        const isV1 = api.context.version.startsWith('1.');
        const jsRule = isV1
          ? chain.module.rule(CHAIN_ID.RULE.JS)
          : chain.module.rule(CHAIN_ID.RULE.JS).oneOf(CHAIN_ID.ONE_OF.JS_MAIN);

        const {
          rspackExperiments: _rspackExperiments,
          collectTypeScriptInfo: _collectTypeScriptInfo,
          detectSyntax: _detectSyntax,
          ...swcOptions
        } = (jsRule.use(CHAIN_ID.USE.SWC).get('options') ||
          {}) as Rspack.SwcLoaderOptions;

        transformCoverageFns[environment.name] = async (
          code: string,
          filename: string,
        ) =>
          rspack.experiments.swc.transform(code, {
            ...swcOptions,
            sourceMaps: true,
            inlineSourcesContent: true,
            jsc: {
              ...swcOptions.jsc,
              parser: {
                syntax: 'typescript',
                tsx: Boolean(swcOptions.jsc?.transform?.react),
                ...(swcOptions.jsc?.parser || {}),
              },
            },
            filename,
          });
      },
      order: 'post',
    });

    api.onExit(() => {
      for (const environmentName of Object.keys(transformCoverageFns)) {
        delete transformCoverageFns[environmentName];
      }
    });
  },
});
