import {
  loadConfig,
  mergeRsbuildConfig,
  type RsbuildConfig,
} from '@rsbuild/core';
import type { ExtendConfig, ExtendConfigFn } from '@rstest/core';

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

export function withRsbuildConfig(
  options: WithRsbuildConfigOptions = {},
): ExtendConfigFn {
  return async () => {
    const {
      configPath,
      modifyRsbuildConfig,
      environmentName,
      cwd = process.cwd(),
    } = options;

    // Load rsbuild config
    const {
      content: { environments, ...rawBuildConfig },
      filePath,
    } = await loadConfig({
      cwd,
      path: configPath,
    });

    if (!filePath) {
      return {};
    }

    const environmentConfig = environmentName
      ? environments?.[environmentName]
      : undefined;

    const rsbuildConfig = environmentConfig
      ? mergeRsbuildConfig<RsbuildConfig>(
          rawBuildConfig as RsbuildConfig,
          environmentConfig as RsbuildConfig,
        )
      : (rawBuildConfig as RsbuildConfig);

    // Allow modification of rsbuild config
    const finalBuildConfig = modifyRsbuildConfig
      ? modifyRsbuildConfig(rsbuildConfig)
      : rsbuildConfig;

    const { rspack, swc, bundlerChain } = finalBuildConfig.tools || {};
    const { cssModules, target, module } = finalBuildConfig.output || {};
    const { decorators, define, include, exclude, tsconfigPath } =
      finalBuildConfig.source || {};

    // Convert rsbuild config to rstest config
    const rstestConfig: ExtendConfig = {
      // Copy over compatible configurations
      root: finalBuildConfig.root,
      name: environmentName,
      plugins: finalBuildConfig.plugins,
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

    return rstestConfig;
  };
}
