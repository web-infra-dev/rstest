import fs from 'node:fs';
import {
  type LoadConfigOptions,
  loadConfig as loadRsbuildConfig,
  mergeRsbuildConfig,
} from '@rsbuild/core';
import deepmerge from 'deepmerge';
import { dirname, isAbsolute, join, resolve } from 'pathe';
import { isCI } from 'std-env';
import type {
  BuiltInReporterNames,
  ExtendConfig,
  NormalizedConfig,
  ProjectConfig,
  RstestConfig,
} from './types';
import {
  castArray,
  color,
  DEFAULT_CONFIG_EXTENSIONS,
  DEFAULT_CONFIG_NAME,
  DEFAULT_TEST_TIMEOUT,
  formatRootStr,
  getOutputDistPathRoot,
  getTempRstestOutputDirGlob,
  isPlainObject,
  logger,
  normalizeBuildCache,
  TEMP_RSTEST_OUTPUT_DIR,
} from './utils';

type ResolvedExtendEntry =
  | ExtendConfig
  | ((
      userConfig: Readonly<RstestConfig>,
    ) => Promise<ExtendConfig> | ExtendConfig);

const DEFAULT_FORCE_RERUN_TRIGGERS = [
  '**/package.json/**',
  '**/rstest.config.*',
];

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

  let config = content as RstestConfig;

  config = await resolveExtends(config);

  return { content: config, filePath: configFilePath };
}

const resolveExtendEntry = async (
  entry: ResolvedExtendEntry,
  userConfig: Readonly<RstestConfig>,
): Promise<ExtendConfig> => {
  const resolved =
    typeof entry === 'function' ? await entry(userConfig) : entry;

  if ('projects' in resolved) {
    const { projects: _projects, ...rest } = resolved;
    return rest;
  }

  return resolved;
};

export const resolveExtends = async (
  config: RstestConfig,
): Promise<RstestConfig> => {
  if (!config.extends) {
    return config;
  }

  const userConfig = Object.freeze({ ...config });
  const extendsEntries = castArray(config.extends);
  const resolvedExtends = await Promise.all(
    extendsEntries.map((entry) => resolveExtendEntry(entry, userConfig)),
  );

  const merged = mergeRstestConfig(...resolvedExtends, config);

  if (config.forceRerunTriggers === undefined) {
    const extendedForceRerunTriggers = resolvedExtends.flatMap(
      (entry) => entry.forceRerunTriggers || [],
    );

    if (extendedForceRerunTriggers.length) {
      merged.forceRerunTriggers = Array.from(
        new Set([
          ...DEFAULT_FORCE_RERUN_TRIGGERS,
          ...extendedForceRerunTriggers,
        ]),
      );
    }
  }

  return merged;
};

/**
 * Deep-merge plain data: recurse into plain objects, replace everything else
 * (arrays, functions, class instances) with the later value.
 *
 * For `browser.providerOptions` — an opaque provider payload that must NOT use
 * `mergeRsbuildConfig`, whose function-chaining / array-concat would corrupt
 * callable options (`launch.logger.log`) or append `launch.args`.
 */
export const plainDeepMerge = <T>(base: T, override: T): T =>
  deepmerge(base ?? {}, override ?? {}, {
    // Recurse only into plain records; arrays, functions and class instances are
    // leaves that get replaced (or kept) by reference, never cloned or merged —
    // otherwise deepmerge would clone a class-instance option (e.g. a Playwright
    // `launch.logger`) into a prototype-less plain object.
    isMergeableObject: isPlainObject,
  }) as T;

export const mergeProjectConfig = (
  ...configs: ProjectConfig[]
): ProjectConfig => {
  return mergeRstestConfig(...configs) as ProjectConfig;
};

export const mergeRstestConfig = (...configs: RstestConfig[]): RstestConfig => {
  return configs.reduce<RstestConfig>((result, config) => {
    const merged = mergeRsbuildConfig(result, {
      ...config,
      // Plain-merged below instead of via mergeRsbuildConfig; see plainDeepMerge.
      browser: undefined,
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

    if (config.browser) {
      // An absent base resolves to `override`, so undefined result.browser is fine.
      merged.browser = plainDeepMerge(result.browser, config.browser);
    }

    // The following configurations need overrides
    merged.include = config.include ?? merged.include;
    merged.forceRerunTriggers =
      config.forceRerunTriggers ?? merged.forceRerunTriggers;
    merged.reporters = config.reporters ?? merged.reporters;
    if (merged.coverage) {
      merged.coverage.reporters =
        config.coverage?.reporters ?? merged.coverage?.reporters;
    }

    return merged;
  }, {});
};

/**
 * Whether the process is running inside GitHub Actions. Single source for the
 * `GITHUB_ACTIONS` runtime signal so every consumer interprets it identically.
 * Reads `process.env` directly so the build-time `process.env.GITHUB_ACTIONS`
 * define keeps controlling it (e.g. forced off in this package's own tests).
 */
export const isGithubActions = (): boolean =>
  process.env.GITHUB_ACTIONS === 'true';

/**
 * Reporters enabled by default. Under GitHub Actions the `github-actions`
 * reporter is added so failures surface as CI annotations. Takes the flag as a
 * parameter (pure) so the selection is unit-testable without mutating env or
 * fighting the build-time `GITHUB_ACTIONS` define.
 */
export const getDefaultReporters = (
  githubActions: boolean = isGithubActions(),
): BuiltInReporterNames[] =>
  githubActions ? ['default', 'github-actions'] : ['default'];

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
  globalSetup: [],
  includeSource: [],
  forceRerunTriggers: DEFAULT_FORCE_RERUN_TRIGGERS,
  pool: {
    type: 'forks',
  },
  isolate: true,
  globals: false,
  passWithNoTests: false,
  update: false,
  testTimeout: DEFAULT_TEST_TIMEOUT,
  hookTimeout: 10_000,
  testEnvironment: {
    name: 'node',
  },
  output: {
    distPath: {
      root: TEMP_RSTEST_OUTPUT_DIR,
    },
  },
  retry: 0,
  reporters: getDefaultReporters(),
  clearMocks: false,
  resetMocks: false,
  restoreMocks: false,
  slowTestThreshold: 300,
  unstubGlobals: false,
  unstubEnvs: false,
  maxConcurrency: 5,
  printConsoleTrace: false,
  disableConsoleIntercept: false,
  silent: false,
  snapshotFormat: {},
  env: {},
  hideSkippedTests: false,
  hideSkippedTestFiles: false,
  logHeapUsage: false,
  detectAsyncLeaks: false,
  bail: 0,
  includeTaskLocation: false,
  federation: false,
  browser: {
    enabled: false,
    provider: 'playwright',
    browser: 'chromium',
    headless: isCI,
    strictPort: false,
    providerOptions: {},
  },
  coverage: {
    exclude: [
      '**/node_modules/**',
      '**/__tests__/**',
      '**/__mocks__/**',
      '**/*.d.ts',
      // This option accepts an array of wax(https://crates.io/crates/wax)-compatible glob patterns
      // not support `?()`: '**/*.{test,spec}.?(c|m)[jt]s?(x)',
      '**/*.{test,spec}.[jt]s',
      '**/*.{test,spec}.[cm][jt]s',
      '**/*.{test,spec}.[jt]sx',
      '**/*.{test,spec}.[cm][jt]sx',
    ],
    enabled: false,
    changed: undefined,
    provider: 'istanbul',
    reporters: ['text', 'html', 'clover', 'json'],
    reportsDirectory: './coverage',
    clean: true,
    reportOnFailure: false,
    allowExternal: false,
  },
});

export const withDefaultConfig = (config: RstestConfig): NormalizedConfig => {
  const merged = mergeRstestConfig(
    createDefaultConfig(),
    config,
  ) as NormalizedConfig;

  merged.setupFiles = castArray(merged.setupFiles);
  merged.globalSetup = castArray(merged.globalSetup);

  const outputDistPathRoot = getOutputDistPathRoot(merged.output?.distPath);
  merged.output.distPath = {
    root: formatRootStr(outputDistPathRoot, merged.root),
  };

  if (merged.performance?.buildCache) {
    merged.performance.buildCache = normalizeBuildCache({
      buildCache: merged.performance.buildCache,
      root: merged.root,
      tsconfigPaths: merged.source?.tsconfigPath
        ? [merged.source.tsconfigPath]
        : [],
      coverageEnabled: merged.coverage?.enabled,
      coverageProvider: merged.coverage?.provider,
      outputDistPathRoot: merged.output.distPath.root,
    });
  }

  merged.exclude.patterns.push(
    getTempRstestOutputDirGlob(merged.output?.distPath?.root),
  );

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

  merged.testEnvironment =
    typeof config.testEnvironment === 'string'
      ? {
          name: config.testEnvironment,
        }
      : merged.testEnvironment;

  merged.browser = {
    enabled: merged.browser?.enabled ?? false,
    provider: merged.browser?.provider ?? 'playwright',
    browser: merged.browser?.browser ?? 'chromium',
    headless: merged.browser?.headless ?? isCI,
    port: merged.browser?.port,
    strictPort: merged.browser?.strictPort ?? false,
    viewport: merged.browser?.viewport,
    providerOptions: merged.browser?.providerOptions ?? {},
  };

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
    globalSetup: merged.globalSetup.map((p) => formatRootStr(p, merged.root)),
    includeSource: merged.includeSource.map((p) =>
      formatRootStr(p, merged.root),
    ),
    forceRerunTriggers: merged.forceRerunTriggers.map((p) =>
      formatRootStr(p, merged.root),
    ),
  };
};
