import {
  type LoadConfigOptions,
  type LoadConfigResult,
  loadConfig as loadRsbuildConfig,
  mergeRsbuildConfig,
} from '@rsbuild/core';
import deepmerge from 'deepmerge';
import { isAbsolute, resolve } from 'pathe';
import { isCI } from 'std-env';
import type {
  BrowserEntry,
  BrowserName,
  BuiltInReporterNames,
  ExtendConfig,
  NormalizedConfig,
  ProjectConfig,
  RstestConfig,
  ResolvedBrowserEntry,
} from './types';
import { BROWSER_NAMES, isBrowserName } from './types';
import {
  castArray,
  DEFAULT_CONFIG_EXTENSIONS,
  DEFAULT_CONFIG_NAME,
  DEFAULT_EXPECT_POLL_TIMEOUT,
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

export interface LoadedRstestConfig {
  content: RstestConfig;
  filePath: string | null;
  dependencies?: string[];
}

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
} = {}): Promise<LoadConfigResult<RstestConfig>> {
  const result = await loadRsbuildConfig<RstestConfig>({
    cwd,
    path,
    configFileNames: DEFAULT_CONFIG_EXTENSIONS.map(
      (ext) => DEFAULT_CONFIG_NAME + ext,
    ),
    envMode,
    loader: configLoader,
  });

  if (!result.filePath) {
    logger.debug('no rstest config file found');
  }

  result.content = await resolveExtends(result.content, result);
  return result;
}

/** Appends `triggers` to `base`, or to the defaults when `base` is unset. */
export const mergeForceRerunTriggers = (
  base: string[] | undefined,
  triggers: string[],
): string[] =>
  Array.from(new Set([...(base ?? DEFAULT_FORCE_RERUN_TRIGGERS), ...triggers]));

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

/**
 * Resolves `extends`, then appends adapter triggers and the `source` config
 * files to `forceRerunTriggers` unless the config sets that option. A filled-in
 * `forceRerunTriggers` counts as explicit, so resolving a `loadConfig` result
 * again is a no-op; `resolveRunnerInputs` relies on that.
 */
export const resolveExtends = async (
  config: RstestConfig,
  source?: Pick<LoadConfigResult<RstestConfig>, 'filePath' | 'dependencies'>,
): Promise<RstestConfig> => {
  const hasOwnTriggers = config.forceRerunTriggers !== undefined;
  let merged = config;
  let extendedTriggers: string[] = [];

  if (config.extends) {
    const userConfig = Object.freeze({ ...config });
    const extendsEntries = castArray(config.extends);
    const resolvedExtends = await Promise.all(
      extendsEntries.map((entry) => resolveExtendEntry(entry, userConfig)),
    );

    merged = mergeRstestConfig(...resolvedExtends, config);
    merged.extends = undefined;
    // Keep the user layer's symbol keys, such as a host's `PROJECT_LOADER`.
    for (const key of Object.getOwnPropertySymbols(config)) {
      Reflect.set(merged, key, Reflect.get(config, key));
    }
    extendedTriggers = resolvedExtends.flatMap(
      (entry) => entry.forceRerunTriggers || [],
    );
  }

  const configFiles = source
    ? source.filePath
      ? [source.filePath, ...source.dependencies]
      : source.dependencies
    : [];
  const appended = [...extendedTriggers, ...configFiles];

  if (!hasOwnTriggers && appended.length) {
    merged.forceRerunTriggers = mergeForceRerunTriggers(undefined, appended);
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

const browserNameList = (): string =>
  BROWSER_NAMES.map((n) => `'${n}'`).join(', ');

/**
 * Validates one CLI/API browser-name token (`--browser.browsers`,
 * `--browser.name`). `source` names the originating flag for the error.
 */
export const assertValidBrowserName = (value: string, source: string): void => {
  if (!isBrowserName(value)) {
    throw new Error(
      `Unknown browser value ${JSON.stringify(value)} for ${source}. Accepted values: ${browserNameList()}.`,
    );
  }
};

const rawBrowserEntries = (
  layer: Partial<RstestConfig['browser']> | undefined,
): [string, string | BrowserEntry][] => {
  const rawValue = layer?.browsers ?? layer?.browser ?? 'chromium';
  return castArray(rawValue).map((item) => [
    typeof item === 'object' ? String(item.browserName) : String(item),
    item,
  ]);
};

/**
 * CLI browser-name filter. `--browser.browsers`/`--browser.name` selects
 * against this config layer's configured browsers: listed names keep their
 * configured entries (with their overrides); a listed name the layer does not
 * configure falls back to a plain entry with the layer's project-level
 * defaults. The result replaces `browser.browsers` and absorbs (deletes) the
 * deprecated `browser.browser` fallback so it is never reported as
 * "set together with browsers".
 */
export const selectCliBrowserEntries = (
  layer: RstestConfig['browser'],
  names: BrowserName[],
): (BrowserName | BrowserEntry)[] => {
  const configured = new Map<BrowserName, BrowserName | BrowserEntry>();
  for (const [name, item] of rawBrowserEntries(layer)) {
    // Malformed entries cannot be matched by a name; normalization reports them.
    if (!isBrowserName(name)) {
      continue;
    }
    if (!configured.has(name)) {
      configured.set(name, item as BrowserName | BrowserEntry);
    }
  }

  return names.map((name) => configured.get(name) ?? name);
};

/**
 * Warned once per process when a config layer still uses the deprecated single
 * `browser` field. The runtime value is normalized away, so the warning cannot
 * key off the normalized config.
 */
let deprecatedBrowserFieldWarned = false;
const warnDeprecatedBrowserField = (): void => {
  if (deprecatedBrowserFieldWarned) {
    return;
  }
  deprecatedBrowserFieldWarned = true;
  logger.warn(
    "`browser.browser` is deprecated and will be removed in 1.0: use `browser.browsers` instead, e.g. `browsers: ['chromium']` or `[{ browserName: 'firefox' }]`.",
  );
};

/**
 * Expands the user-layer `browser.browsers` / deprecated `browser.browser`
 * value into one raw entry per configured browser, preserving overrides.
 * Shape errors are raised only for browser projects (mirrors how provider/viewport
 * validation only runs for `browser.enabled: true` config), while the
 * normalization result itself always satisfies the non-empty default.
 *
 * The user layer — not the defaults-merged layer — is the expansion source: the
 * built-in defaults would otherwise force their own browser onto entries.
 */
type BrowserEntryDefaults = Omit<ResolvedBrowserEntry, 'browserName'>;

const normalizeBrowserEntries = (
  userBrowser: RstestConfig['browser'],
  defaults: BrowserEntryDefaults & { enabled: boolean },
): ResolvedBrowserEntry[] => {
  // Browser config carries shape errors only for browser projects; a disabled
  // layer always normalizes to the built-in default so the non-empty invariant
  // holds for every `NormalizedBrowserModeConfig`.
  if (!defaults.enabled) {
    return [resolvedBrowserEntry(null, defaults)];
  }

  if (
    userBrowser?.browser !== undefined &&
    userBrowser?.browsers !== undefined
  ) {
    throw new Error(
      '`browser.browser` and `browser.browsers` cannot be set together: `browser.browser` is deprecated and superseded by `browsers`. Configure `browser.browsers` only.',
    );
  }

  const rawEntries = rawBrowserEntries(userBrowser);
  if (rawEntries.length === 0) {
    throw new Error(
      '`browser.browsers` must not be empty. Remove the option to run the default Chromium.',
    );
  }

  const entries: ResolvedBrowserEntry[] = [];
  const seen = new Set<BrowserName>();
  for (const [browserName, item] of rawEntries) {
    const entry = typeof item === 'object' ? item : undefined;
    if (!isBrowserName(browserName)) {
      throw new Error(
        `Browser entry must either be a browser name (${browserNameList()}) or an object with a \`browserName\` field of those values. Received: ${JSON.stringify(entry ?? item)}.`,
      );
    }
    if (seen.has(browserName)) {
      throw new Error(
        `Browser '${browserName}' appears twice in \`browser.browsers\`: each browser may be configured at most once per project.`,
      );
    }
    seen.add(browserName);
    entries.push(resolvedBrowserEntry(entry ?? { browserName }, defaults));
  }

  return entries;
};

/**
 * Overrides per entry field: an entry field set wins, then the project-level
 * default. `providerOptions` merges per top-level key (`launch`, `context`)
 * instead of whole-field, so an entry tweak keeps sibling provider keys.
 */
const resolvedBrowserEntry = (
  entry: BrowserEntry | null,
  defaults: BrowserEntryDefaults,
): ResolvedBrowserEntry => ({
  browserName: entry?.browserName ?? 'chromium',
  headless: entry?.headless ?? defaults.headless,
  screenshotFailures: entry?.screenshotFailures ?? defaults.screenshotFailures,
  viewport: entry?.viewport ?? defaults.viewport,
  expect: entry?.expect ?? defaults.expect,
  providerOptions: { ...defaults.providerOptions, ...entry?.providerOptions },
});

export const clonePlainConfig = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => clonePlainConfig(item)) as T;
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clonePlainConfig(item)]),
    ) as T;
  }

  return value;
};

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
  onlyFailures: false,
  update: false,
  testTimeout: DEFAULT_TEST_TIMEOUT,
  hookTimeout: 10_000,
  sequence: { hooks: 'stack', setupFiles: 'list' },
  teardownTimeout: 10_000,
  testEnvironment: {
    name: 'node',
  },
  output: {
    distPath: {
      root: TEMP_RSTEST_OUTPUT_DIR,
    },
  },
  retry: 0,
  repeats: 0,
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
  snapshotFormat: {
    printShadowRoot: false,
  },
  expect: {
    poll: {
      interval: 50,
      timeout: DEFAULT_EXPECT_POLL_TIMEOUT,
    },
  },
  env: {},
  hideSkippedTests: false,
  hideSkippedTestFiles: false,
  logHeapUsage: false,
  detectAsyncLeaks: false,
  bail: 0,
  includeTaskLocation: false,
  federation: false,
  // Pre-normalization seed: `withDefaultConfig` re-derives every browser entry
  // from the user layer, so this list only keeps the merged layer type-shaped.
  browser: {
    enabled: false,
    provider: 'playwright',
    browsers: [
      {
        browserName: 'chromium',
        headless: isCI,
        screenshotFailures: isCI,
        providerOptions: {},
      },
    ],
    headless: isCI,
    screenshotFailures: isCI,
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

  const browserDefaults = {
    enabled: merged.browser?.enabled ?? false,
    provider: merged.browser?.provider ?? 'playwright',
    headless: merged.browser?.headless ?? isCI,
    screenshotFailures:
      config.browser?.screenshotFailures ?? merged.browser?.headless ?? isCI,
    port: merged.browser?.port,
    strictPort: merged.browser?.strictPort ?? false,
    viewport: merged.browser?.viewport,
    providerOptions: merged.browser?.providerOptions ?? {},
    ...(merged.browser?.expect === undefined
      ? {}
      : { expect: merged.browser.expect }),
  };

  merged.browser = {
    ...browserDefaults,
    browsers: normalizeBrowserEntries(config.browser, browserDefaults),
  };

  if (browserDefaults.enabled && config.browser?.browser !== undefined) {
    warnDeprecatedBrowserField();
  }

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
