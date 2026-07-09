import { isAbsolute, join } from 'node:path';
import { loadConfig, type RsbuildConfig } from '@rsbuild/core';
import type { ExtendConfigFn } from '@rstest/core';
import { toRstestConfig } from './toRstestConfig';

export interface WithRsbuildConfigOptions {
  /**
   * Rsbuild config object to convert directly.
   * When provided, `configPath` is only used as file metadata.
   * @default undefined
   */
  config?: RsbuildConfig;
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
      config: inlineConfig,
      configPath,
      modifyRsbuildConfig,
      environmentName,
      cwd = process.cwd(),
    } = options;

    let rsbuildConfig: RsbuildConfig;
    let filePath: string | undefined;

    if (inlineConfig) {
      rsbuildConfig = inlineConfig;
      if (configPath) {
        filePath = configPath;
        if (!isAbsolute(configPath)) {
          filePath = join(cwd, configPath);
        }
      }
    } else {
      const loadedConfig = await loadConfig({
        cwd,
        path: configPath,
      });
      rsbuildConfig = loadedConfig.content;
      if (loadedConfig.filePath) {
        filePath = loadedConfig.filePath;
      }
    }

    if (!filePath && !inlineConfig) {
      return {};
    }

    const rstestConfig = toRstestConfig({
      environmentName,
      rsbuildConfig,
      configPath: filePath,
      modifyRsbuildConfig,
    });

    return rstestConfig;
  };
}

export { toRstestConfig };
