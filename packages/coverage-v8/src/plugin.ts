import { createRequire } from 'node:module';
import type { RsbuildPlugin, Rspack } from '@rstest/core';

type TransformCoverageFn = (
  code: string,
  filename: string,
) => Promise<{ code: string; map?: string }>;

type SwcTransformFn =
  typeof import('@rsbuild/core').rspack.experiments.swc.transform;
type SwcTransformInputOptions = Omit<
  Rspack.SwcLoaderOptions,
  | 'rspackExperiments'
  | 'collectTypeScriptInfo'
  | 'detectSyntax'
  | 'transformImport'
>;

const transformCoverageFns: Record<string, TransformCoverageFn> = {};
let fallbackTransformCoverageFn: TransformCoverageFn | undefined;

const transformWithSwc = (
  transform: SwcTransformFn,
  swcOptions: SwcTransformInputOptions,
  code: string,
  filename: string,
): ReturnType<TransformCoverageFn> => {
  const isTypeScript = /\.[cm]?tsx?$/i.test(filename);
  const isJsx = /\.[jt]sx$/i.test(filename);

  return transform(code, {
    ...swcOptions,
    sourceMaps: true,
    inlineSourcesContent: true,
    jsc: {
      ...swcOptions.jsc,
      parser: isTypeScript
        ? {
            ...swcOptions.jsc?.parser,
            syntax: 'typescript',
            tsx: isJsx,
          }
        : {
            ...swcOptions.jsc?.parser,
            syntax: 'ecmascript',
            jsx: isJsx,
          },
    },
    filename,
  });
};

const getFallbackTransformCoverageFn = (): TransformCoverageFn => {
  if (!fallbackTransformCoverageFn) {
    const require = createRequire(import.meta.url);
    const requireFromCore = createRequire(
      require.resolve('@rstest/core/package.json'),
    );
    // Resolve through core so coverage-v8 reuses its matching native Rspack dependency.
    const { rspack } = requireFromCore('@rsbuild/core') as {
      rspack: {
        experiments: { swc: { transform: SwcTransformFn } };
      };
    };
    fallbackTransformCoverageFn = (code, filename) =>
      transformWithSwc(rspack.experiments.swc.transform, {}, code, filename);
  }
  return fallbackTransformCoverageFn;
};

export const transformCoverage = async (
  environmentName: string,
  code: string,
  filename: string,
): ReturnType<TransformCoverageFn> => {
  const transform =
    transformCoverageFns[environmentName] || getFallbackTransformCoverageFn();
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
          transformImport: _transformImport,
          ...swcOptions
        } = (jsRule.use(CHAIN_ID.USE.SWC).get('options') ||
          {}) as Rspack.SwcLoaderOptions;

        transformCoverageFns[environment.name] = async (
          code: string,
          filename: string,
        ) =>
          transformWithSwc(
            rspack.experiments.swc.transform,
            swcOptions,
            code,
            filename,
          );
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
