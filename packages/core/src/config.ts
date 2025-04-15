import fs from 'node:fs';
import {
  type LoadConfigOptions,
  loadConfig as loadRsbuildConfig,
  mergeRsbuildConfig,
} from '@rsbuild/core';
import { dirname, isAbsolute, join } from 'pathe';
import type { NormalizedConfig, RstestConfig } from './types';
import {
  DEFAULT_CONFIG_EXTENSIONS,
  DEFAULT_CONFIG_NAME,
  color,
  logger,
} from './utils';

const findConfig = (basePath: string): string | undefined => {
  return DEFAULT_CONFIG_EXTENSIONS.map((ext) => basePath + ext).find(
    fs.existsSync,
  );
};

const resolveConfigPath = (root: string, customConfig?: string) => {
  if (customConfig) {
    const customConfigPath = isAbsolute(customConfig)
      ? customConfig
      : join(root, customConfig);
    if (fs.existsSync(customConfigPath)) {
      return customConfigPath;
    }
    logger.warn(`Cannot find config file: ${color.dim(customConfigPath)}`);
    logger.log('');
  }

  const configFilePath = findConfig(join(root, DEFAULT_CONFIG_NAME));

  if (configFilePath) {
    return configFilePath;
  }

  return null;
};

export async function loadConfig({
  cwd = process.cwd(),
  path,
  envMode,
  configLoader,
}: {
  cwd?: string;
  path?: string;
  envMode?: string;
  configLoader?: LoadConfigOptions['loader'];
}): Promise<{
  content: RstestConfig;
  filePath: string | null;
}> {
  const configFilePath = resolveConfigPath(cwd, path);

  if (!configFilePath) {
    logger.debug('no config file found');
    return {
      content: {},
      filePath: configFilePath,
    };
  }

  const { content } = await loadRsbuildConfig({
    cwd: dirname(configFilePath),
    path: configFilePath,
    envMode,
    loader: configLoader,
  });

  return { content: content as RstestConfig, filePath: configFilePath };
}

export const mergeRstestConfig = (...configs: RstestConfig[]): RstestConfig =>
  mergeRsbuildConfig<RstestConfig>(...configs);

const createDefaultConfig = (): NormalizedConfig => ({
  root: process.cwd(),
  name: 'rstest',
  include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)'],
  exclude: ['**/node_modules/**', '**/dist/**'],
  pool: {
    type: 'forks',
  },
  isolate: true,
  globals: false,
  passWithNoTests: false,
  update: false,
  reporters: ['default'],
});

export const withDefaultConfig = (config: RstestConfig): NormalizedConfig => {
  const merged = mergeRstestConfig(createDefaultConfig(), config);

  // The following configurations need overrides
  merged.include = config.include || merged.include;
  merged.exclude = config.exclude || merged.exclude;
  merged.reporters = config.reporters ?? merged.reporters;
  merged.pool =
    typeof config.pool === 'string'
      ? {
          type: config.pool,
        }
      : merged.pool;

  return merged as NormalizedConfig;
};
