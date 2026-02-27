import { mergeRsbuildConfig, type RsbuildConfig } from '@rsbuild/core';
import type { ExtendConfig } from '@rstest/core';

export interface WithRsbuildConfigOptions {
  /**
   * `cwd` passed to loadConfig of Rsbuild
   * @default process.cwd()
   */
  cwd?: string;
  /**
   * Path to rsbuild config file
   * @default './rsbuild.config.ts'
   */
  configPath?: string;
  /**
   * The environment name in `environments` field to use, will be merged with the common config.
   * Set to a string to use the environment config with matching name.
   * @default undefined
   */
  environmentName?: string;
  /**
   * Modify rsbuild config before converting to rstest config
   */
  modifyRsbuildConfig?: (buildConfig: RsbuildConfig) => RsbuildConfig;
}

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
  const { decorators, define, include, exclude, tsconfigPath } =
    finalBuildConfig.source || {};

  return {
    root: finalBuildConfig.root,
    name: environmentName,
    plugins: [
      ...(finalBuildConfig.plugins || []),
      // remove some plugins that are not needed or not compatible in test environment
      {
        name: 'remove-useless-plugins',
        remove: ['rsbuild:type-check'],
        setup: () => {},
      },
    ],
    source: {
      decorators,
      define,
      include,
      exclude,
      tsconfigPath,
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
