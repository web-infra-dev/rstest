import { loadConfig, type RslibConfig, rsbuild } from '@rslib/core';
import type { ExtendConfig, ExtendConfigFn } from '@rstest/core';

export interface WithRslibConfigOptions {
  /**
   * `cwd` passed to loadConfig of Rslib
   * @default process.cwd()
   */
  cwd?: string;
  /**
   * Path to rslib config file
   * @default './rslib.config.ts'
   */
  configPath?: string;
  /**
   * The lib config id in `lib` field to use, will be merged with the other fields in the config.
   * Set to a string to use the lib config with matching id.
   * @default undefined
   */
  libId?: string;
  /**
   * Modify rslib config before converting to rstest config
   */
  modifyLibConfig?: (libConfig: RslibConfig) => RslibConfig;
}

export function withRslibConfig(
  options: WithRslibConfigOptions = {},
): ExtendConfigFn {
  return async (userConfig) => {
    const { configPath, modifyLibConfig, libId, cwd } = options;

    // Load rslib config
    const {
      content: { lib, ...rawLibConfig },
      filePath,
    } = await loadConfig({
      cwd,
      path: configPath,
    });

    if (!filePath) {
      return {};
    }

    const libConfig =
      libId && Array.isArray(lib) ? lib.find((l) => l.id === libId) || {} : {};

    if (!userConfig.source?.tsconfigPath) {
      // TODO: decorators
    }

    const rslibConfig = Array.isArray(lib)
      ? rsbuild.mergeRsbuildConfig<RslibConfig>(
          rawLibConfig as RslibConfig,
          libConfig as RslibConfig,
        )
      : (rawLibConfig as RslibConfig);

    // Allow modification of rslib config
    const finalLibConfig = modifyLibConfig
      ? modifyLibConfig(rslibConfig)
      : rslibConfig;

    const { rspack, swc, bundlerChain } = finalLibConfig.tools || {};
    const { cssModules, target } = finalLibConfig.output || {};
    const { decorators, define, include, exclude, tsconfigPath } =
      finalLibConfig.source || {};

    // Convert rslib config to rstest config
    const rstestConfig: ExtendConfig = {
      // Copy over compatible configurations
      root: finalLibConfig.root,
      name: libId,
      plugins: finalLibConfig.plugins,
      source: {
        decorators,
        define,
        include,
        exclude,
        tsconfigPath,
      },
      resolve: finalLibConfig.resolve,
      output: {
        cssModules,
        module: finalLibConfig.output?.module ?? libConfig.format !== 'cjs',
      },
      tools: {
        rspack,
        swc,
        bundlerChain,
      } as ExtendConfig['tools'],

      testEnvironment: target === 'web' ? 'happy-dom' : 'node',
    };

    return rstestConfig;
  };
}
