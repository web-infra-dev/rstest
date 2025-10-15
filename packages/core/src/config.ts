import fs from 'node:fs';
import {
  type LoadConfigOptions,
  loadConfig as loadRsbuildConfig,
  mergeRsbuildConfig,
} from '@rsbuild/core';
import { dirname, isAbsolute, join, resolve } from 'pathe';
import type { NormalizedConfig, RstestConfig } from './types';
import {
  castArray,
  color,
  DEFAULT_CONFIG_EXTENSIONS,
  DEFAULT_CONFIG_NAME,
  formatRootStr,
  logger,
  TEMP_RSTEST_OUTPUT_DIR_GLOB,
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
    throw `Cannot find config file: ${color.dim(customConfigPath)}`;
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
    logger.debug('no rstest config file found');
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

export const mergeRstestConfig = (...configs: RstestConfig[]): RstestConfig => {
  return configs.reduce<RstestConfig>((result, config) => {
    const merged = mergeRsbuildConfig(result, {
      ...config,
      exclude: Array.isArray(config.exclude)
        ? {
            patterns: config.exclude,
            override: false,
          }
        : config.exclude,
    });

    if (!Array.isArray(config.exclude) && config.exclude?.override) {
      merged.exclude = {
        patterns: config.exclude.patterns,
      };
    }

    // The following configurations need overrides
    merged.include = config.include ?? merged.include;
    merged.reporters = config.reporters ?? merged.reporters;
    if (merged.coverage) {
      merged.coverage.reporters =
        config.coverage?.reporters ?? merged.coverage?.reporters;
    }

    return merged;
  }, {});
};

const createDefaultConfig = (): NormalizedConfig => ({
  root: process.cwd(),
  name: 'rstest',
  include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)'],
  exclude: {
    patterns: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
    ],
    override: false,
  },
  setupFiles: [],
  includeSource: [],
  pool: {
    type: 'forks',
  },
  isolate: true,
  globals: false,
  passWithNoTests: false,
  update: false,
  testTimeout: 5_000,
  hookTimeout: 10_000,
  testEnvironment: 'node',
  retry: 0,
  reporters:
    process.env.GITHUB_ACTIONS === 'true'
      ? ['default', 'github-actions']
      : ['default'],
  clearMocks: false,
  resetMocks: false,
  restoreMocks: false,
  slowTestThreshold: 300,
  unstubGlobals: false,
  unstubEnvs: false,
  maxConcurrency: 5,
  printConsoleTrace: false,
  disableConsoleIntercept: false,
  snapshotFormat: {},
  env: {},
  coverage: {
    exclude: [
      '**/node_modules/**',
      '**/[.]*',
      '**/dist/**',
      '**/test/**',
      '**/__tests__/**',
      '**/__mocks__/**',
      '**/*.d.ts',
      // This option accepts an array of wax(https://crates.io/crates/wax)-compatible glob patterns
      // not support `?()`: '**/*.{test,spec}.?(c|m)[jt]s?(x)',
      '**/*.{test,spec}.[jt]s',
      '**/*.{test,spec}.[c|m][jt]s',
      '**/*.{test,spec}.[jt]sx',
      '**/*.{test,spec}.[c|m][jt]sx',
    ],
    enabled: false,
    provider: 'istanbul',
    reporters: ['text', 'html', 'clover', 'json'],
    reportsDirectory: './coverage',
    clean: true,
    reportOnFailure: false,
  },
});

export const withDefaultConfig = (config: RstestConfig): NormalizedConfig => {
  const merged = mergeRstestConfig(
    createDefaultConfig(),
    config,
  ) as NormalizedConfig;

  merged.setupFiles = castArray(merged.setupFiles);

  merged.exclude.patterns.push(TEMP_RSTEST_OUTPUT_DIR_GLOB);

  const reportsDirectory = formatRootStr(
    merged.coverage.reportsDirectory,
    merged.root,
  );
  merged.coverage.reportsDirectory = isAbsolute(reportsDirectory)
    ? reportsDirectory
    : resolve(merged.root, reportsDirectory);

  merged.pool =
    typeof config.pool === 'string'
      ? {
          type: config.pool,
        }
      : merged.pool;

  return {
    ...merged,
    include: merged.include.map((p) => formatRootStr(p, merged.root)),
    exclude: {
      ...merged.exclude,
      patterns: merged.exclude.patterns.map((p) =>
        formatRootStr(p, merged.root),
      ),
    },
    setupFiles: merged.setupFiles.map((p) => formatRootStr(p, merged.root)),
    includeSource: merged.includeSource.map((p) =>
      formatRootStr(p, merged.root),
    ),
  };
};
