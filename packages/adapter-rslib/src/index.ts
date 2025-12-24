import { loadConfig, type RslibConfig, rsbuild } from '@rslib/core';
import type { RstestConfig } from '@rstest/core';

export interface WithRslibConfigOptions {
  /**
   * `cwd` passed to loadConfig of Rslib
   * @default undefined
   */
  cwd?: string;
  /**
   * Path to rslib config file
   * @default './rslib.config.ts'
   */
  configPath?: string;
  /**
   * The lib config index in `lib` field to use, will be merged with the other fields in the config.
   * Set to a number to use the lib config at that index.
   * Set to `false` to disable using the lib config.
   * @default 0
   */
  libIndex?: number | false;
  /**
   * Modify rslib config before converting to rstest config
   */
  modifyLibConfig?: (libConfig: RslibConfig) => RslibConfig;
}

export async function withRslibConfig(
  options: WithRslibConfigOptions = {},
): Promise<Omit<RstestConfig, 'projects'>> {
  const { configPath, modifyLibConfig, libIndex = 0 } = options;

  // Load rslib config
  const {
    content: { lib, ...rawLibConfig },
    filePath,
  } = await loadConfig({
    cwd: process.cwd(),
    path: configPath,
  });

  if (!filePath) {
    return {};
  }

  const libConfig = libIndex !== false ? lib[libIndex] || {} : {};

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
  const rstestConfig: RstestConfig = {
    // Copy over compatible configurations
    root: finalLibConfig.root,
    name: libConfig.id,
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
    } as RstestConfig['tools'],

    testEnvironment: target === 'web' ? 'happy-dom' : 'node',
  };

  return rstestConfig;
}
