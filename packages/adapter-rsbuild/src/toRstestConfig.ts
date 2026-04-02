import { mergeRsbuildConfig, type RsbuildConfig } from '@rsbuild/core';
import type { ExtendConfig } from '@rstest/core';

/**
 * Convert rsbuild config to rstest config
 */
export function toRstestConfig({
  environmentName,
  rsbuildConfig: rawRsbuildConfig,
  modifyRsbuildConfig,
}: {
  environmentName?: string;
  rsbuildConfig: RsbuildConfig;
  modifyRsbuildConfig?: (buildConfig: RsbuildConfig) => RsbuildConfig;
}): ExtendConfig {
  const { environments, ...rawBuildConfig } = rawRsbuildConfig;

  const environmentConfig = environmentName
    ? environments?.[environmentName]
    : undefined;

  const rsbuildConfig = environmentConfig
    ? mergeRsbuildConfig<RsbuildConfig>(
        rawBuildConfig as RsbuildConfig,
        environmentConfig as RsbuildConfig,
      )
    : (rawBuildConfig as RsbuildConfig);

  const finalBuildConfig = modifyRsbuildConfig
    ? modifyRsbuildConfig(rsbuildConfig)
    : rsbuildConfig;

  const { rspack, swc, bundlerChain } = finalBuildConfig.tools || {};
  const { cssModules, target, module } = finalBuildConfig.output || {};
  const {
    assetsInclude,
    decorators,
    define,
    include,
    exclude,
    tsconfigPath,
    transformImport,
  } = finalBuildConfig.source || {};

  return {
    root: finalBuildConfig.root,
    name: environmentName,
    plugins: [
      ...(finalBuildConfig.plugins || []),
      // remove some plugins that are not needed or not compatible in test environment
      {
        name: 'rsbuild-adapter:remove-useless-plugins',
        remove: ['rsbuild:type-check'],
        setup: () => {},
      },
    ],
    source: {
      assetsInclude,
      decorators,
      define,
      include,
      exclude,
      tsconfigPath,
      transformImport,
    },
    resolve: finalBuildConfig.resolve,
    output: {
      cssModules,
      module,
    },
    tools: {
      rspack,
      swc,
      bundlerChain,
    } as ExtendConfig['tools'],
    testEnvironment: target === 'node' ? 'node' : 'happy-dom',
  };
}
