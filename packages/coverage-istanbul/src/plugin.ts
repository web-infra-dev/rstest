import { createRequire } from 'node:module';
import type {
  NormalizedCoverageOptions,
  RsbuildPlugin,
  Rspack,
} from '@rstest/core';

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

const require = createRequire(import.meta.url);
const transformCoverageFns: Record<string, TransformCoverageFn> = {};
let fallbackSwcTransform: SwcTransformFn | undefined;
let swcPluginPath: string | undefined;

const getSwcPluginPath = (): string => {
  swcPluginPath ??= require.resolve('swc-plugin-coverage-instrument');
  return swcPluginPath;
};

const addCoverageInstrumentation = (
  swcOptions: SwcTransformInputOptions,
  options: NormalizedCoverageOptions,
): void => {
  swcOptions.jsc ??= {};
  swcOptions.jsc.experimental ??= {};
  swcOptions.jsc.experimental.plugins ??= [];
  swcOptions.jsc.experimental.plugins.push([
    getSwcPluginPath(),
    {
      unstableExclude: options.exclude,
    },
  ]);
};

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

const getFallbackSwcTransform = (): SwcTransformFn => {
  if (!fallbackSwcTransform) {
    const requireFromCore = createRequire(
      require.resolve('@rstest/core/package.json'),
    );
    const { rspack } = requireFromCore('@rsbuild/core') as {
      rspack: {
        experiments: { swc: { transform: SwcTransformFn } };
      };
    };
    fallbackSwcTransform = rspack.experiments.swc.transform;
  }
  return fallbackSwcTransform;
};

const transformCoverage = async (
  environmentName: string,
  code: string,
  filename: string,
  options: NormalizedCoverageOptions,
): ReturnType<TransformCoverageFn> => {
  const transform = transformCoverageFns[environmentName];
  if (transform) {
    return transform(code, filename);
  }

  const swcOptions: SwcTransformInputOptions = {};
  addCoverageInstrumentation(swcOptions, options);
  return transformWithSwc(
    getFallbackSwcTransform(),
    swcOptions,
    code,
    filename,
  );
};

export { transformCoverage };

export const pluginCoverage: (
  options: NormalizedCoverageOptions,
) => RsbuildPlugin = (options) => ({
  name: 'rstest:coverage',
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

        addCoverageInstrumentation(swcOptions, options);

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
