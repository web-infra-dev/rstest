import { loadConfig, type RsbuildConfig } from '@rsbuild/core';
import type { ExtendConfigFn } from '@rstest/core';
import { toRstestConfig } from './toRstestConfig';

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
    const { content: rsbuildConfig, filePath } = await loadConfig({
      cwd,
      path: configPath,
    });

    if (!filePath) {
      return {};
    }

    const rstestConfig = toRstestConfig({
      environmentName,
      rsbuildConfig,
      modifyRsbuildConfig,
    });

    return rstestConfig;
  };
}

export { toRstestConfig };
