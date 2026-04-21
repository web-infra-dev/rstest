import { dirname, isAbsolute, resolve } from 'node:path';
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

const addRsbuildConfigDependency = (
  config: RsbuildConfig,
  filePath: string,
): RsbuildConfig => {
  const buildCache = config.performance?.buildCache;

  if (!buildCache) {
    return config;
  }

  const configDir = dirname(filePath);
  const buildDependencies =
    buildCache === true ? [] : buildCache.buildDependencies || [];

  return {
    ...config,
    performance: {
      ...config.performance,
      buildCache: {
        ...(buildCache === true ? {} : buildCache),
        buildDependencies: Array.from(
          new Set([
            ...buildDependencies.map((dependency) =>
              isAbsolute(dependency)
                ? dependency
                : resolve(configDir, dependency),
            ),
            filePath,
          ]),
        ),
      },
    },
  };
};

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
      modifyRsbuildConfig: (config) => {
        const nextConfig = modifyRsbuildConfig
          ? modifyRsbuildConfig(config)
          : config;

        return addRsbuildConfigDependency(nextConfig, filePath);
      },
    });

    return rstestConfig;
  };
}

export { toRstestConfig };
