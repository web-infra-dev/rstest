import {
  mergeRsbuildConfig,
  type RsbuildConfig,
  type RsbuildPlugin,
} from '@rsbuild/core';
import type { ExtendConfig } from '@rstest/core';

export interface ConvertRsbuildToRstestConfigOptions {
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
  /**
   * Rsbuild config to convert
   */
  rsbuildConfig: RsbuildConfig;
}

export function convertRsbuildToRstestConfig({
  environmentName,
  rsbuildConfig: rawRsbuildConfig,
  modifyRsbuildConfig,
}: ConvertRsbuildToRstestConfigOptions): ExtendConfig {
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

  // remove some plugins that are not compatible with rstest, such as type-check plugin which will cause issues when used in rstest
  const rstestRemovePlugin: RsbuildPlugin = {
    name: 'remove-useless-plugins',
    remove: ['rsbuild:type-check'],
    setup: () => {},
  };

  return {
    root: finalBuildConfig.root,
    name: environmentName,
    plugins: [...(finalBuildConfig.plugins || []), rstestRemovePlugin],
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
