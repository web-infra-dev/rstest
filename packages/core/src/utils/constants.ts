import { dirname, isAbsolute, join, normalize, resolve } from 'pathe';
import type {
  ProjectContext,
  Rstest,
  RstestBuildCacheConfig,
  RstestConfig,
  RstestContext,
} from '../types';

export const DEFAULT_CONFIG_NAME = 'rstest.config';

export const TEST_DELIMITER = '>';

export const POINTER = '➜';

export const ROOT_SUITE_NAME = 'Rstest:_internal_root_suite';

/**
 * Description key of the well-known `Symbol.for(...)` under which Rstest stores
 * the runtime env store on `globalThis`. Single owner of the string, shared by
 * three contexts that must resolve the SAME registry symbol: the core worker
 * runtime and the browser client both call `Symbol.for(RSTEST_ENV_SYMBOL_KEY)`,
 * while the host bakes it into the rspack `define` text via
 * `JSON.stringify(RSTEST_ENV_SYMBOL_KEY)`. Kept a plain string (not a Symbol) so
 * it serves both the runtime and the build-define codegen path. Re-exported from
 * both `./internal/browser-runtime` and `./internal/browser` barrels.
 */
export const RSTEST_ENV_SYMBOL_KEY = 'rstest.env';

/**
 * Single source of truth for the built-in browser provider identifiers.
 *
 * Core owns this list because the peer-dependency direction is one-way
 * (`@rstest/browser` depends on `@rstest/core`, never the reverse), so the CLI
 * `init` templates here cannot import the registry from `@rstest/browser`.
 * `@rstest/browser` re-exports {@link BrowserProvider} and keys its provider
 * registry by it (`Record<BrowserProvider, …>`), so adding a provider here
 * forces a matching implementation there — a missing key is a compile error.
 */
export const BROWSER_PROVIDERS = ['playwright'] as const;
export type BrowserProvider = (typeof BROWSER_PROVIDERS)[number];

export const TEMP_RSTEST_OUTPUT_DIR = 'dist/.rstest-temp';
const DEFAULT_BUILD_CACHE_PREFIX = 'node_modules/.cache/rstest';

/**
 * Directory for the perf-first test-sequencing cache (see `core/resultsCache.ts`).
 * The leading dot is load-bearing: it must NOT reuse `rstest` or `rstest-*`.
 * The Rspack build cache occupies `node_modules/.cache/rstest` (no environment)
 * and `node_modules/.cache/rstest-<environmentName>` (see
 * `getDefaultBuildCacheDir`), so a plain `rstest-sequence` would collide with a
 * build cache for an environment literally named `sequence`. A dotted prefix is
 * the only construction guaranteed collision-free against every build cache dir,
 * and it matches the `dist/.rstest-temp` style. Kept here, next to the build
 * cache prefix, so renaming the build cache naming can't silently break this
 * construction-based no-collision invariant.
 */
export const SEQUENCE_CACHE_DIR = 'node_modules/.cache/.rstest-sequence';
const DEFAULT_BUILD_CACHE_DIRECTORY_MARKER = Symbol(
  'defaultBuildCacheDirectory',
);

export const getOutputDistPathRoot = (
  distPath?: NonNullable<RstestConfig['output']>['distPath'],
): string =>
  (typeof distPath === 'string' ? distPath : distPath?.root) ??
  TEMP_RSTEST_OUTPUT_DIR;

export const getTempRstestOutputDir = ({
  distPathRoot,
  environmentName,
  multipleProjects = false,
}: {
  distPathRoot: string;
  environmentName?: string;
  multipleProjects?: boolean;
}): string => {
  const outputRoot = normalize(distPathRoot);
  return multipleProjects && environmentName
    ? join(outputRoot, environmentName)
    : outputRoot;
};

export const getTempRstestOutputDirGlob = (distPathRoot: string): string => {
  const outputRoot = normalize(distPathRoot);

  if (isAbsolute(outputRoot)) {
    return outputRoot;
  }

  return `**/${outputRoot.replace(/^\.?\//, '')}`;
};

type BuildCacheInput = {
  buildCache?: boolean | RstestBuildCacheConfig;
  root: string;
  configFilePath?: string;
  projectConfigFilePaths?: string[];
  tsconfigPaths?: string[];
  command?: string;
  environmentName?: string;
  browserEnabled?: boolean;
  coverageEnabled?: boolean;
  coverageProvider?: string;
  outputDistPathRoot?: string;
  assumeNormalized?: boolean;
};

export const getDefaultBuildCacheDir = (environmentName?: string): string =>
  environmentName
    ? `${DEFAULT_BUILD_CACHE_PREFIX}-${environmentName}`
    : DEFAULT_BUILD_CACHE_PREFIX;

type InternalBuildCacheConfig = RstestBuildCacheConfig & {
  [DEFAULT_BUILD_CACHE_DIRECTORY_MARKER]?: true;
};

export const normalizeBuildCache = ({
  buildCache,
  root,
  configFilePath,
  projectConfigFilePaths = [],
  tsconfigPaths = [],
  command,
  environmentName,
  browserEnabled,
  coverageEnabled,
  coverageProvider,
  outputDistPathRoot,
  assumeNormalized = false,
}: BuildCacheInput): false | RstestBuildCacheConfig => {
  if (!buildCache) {
    return false;
  }

  const userConfig: InternalBuildCacheConfig =
    buildCache === true ? {} : buildCache;
  const buildDependencies = Array.from(
    new Set(
      [
        configFilePath,
        ...projectConfigFilePaths,
        ...tsconfigPaths,
        ...(userConfig.buildDependencies || []),
      ]
        .filter(Boolean)
        .map((filePath) =>
          isAbsolute(filePath as string)
            ? normalize(filePath as string)
            : resolve(root, filePath as string),
        ),
    ),
  );

  const userCacheDigest =
    assumeNormalized && userConfig.cacheDigest?.[0] === 'rstest'
      ? userConfig.cacheDigest.slice(6)
      : userConfig.cacheDigest || [];
  const coverageDigest = coverageEnabled
    ? `coverage:${coverageProvider}`
    : 'no-coverage';
  const cacheDigest = [
    'rstest',
    command,
    environmentName,
    browserEnabled ? 'browser' : 'node',
    coverageDigest,
    outputDistPathRoot,
    ...userCacheDigest,
  ];

  const isDefaultCacheDirectory =
    buildCache === true ||
    !userConfig.cacheDirectory ||
    userConfig[DEFAULT_BUILD_CACHE_DIRECTORY_MARKER];

  const cacheDirectory = isDefaultCacheDirectory
    ? getDefaultBuildCacheDir(environmentName)
    : userConfig.cacheDirectory!;

  const normalized = {
    cacheDirectory: resolve(root, cacheDirectory),
    cacheDigest,
    buildDependencies,
  };

  if (isDefaultCacheDirectory) {
    Object.defineProperty(normalized, DEFAULT_BUILD_CACHE_DIRECTORY_MARKER, {
      value: true,
    });
  }

  return normalized;
};

export const isDefaultBuildCache = (
  buildCache: boolean | RstestBuildCacheConfig | undefined,
): boolean =>
  buildCache === true ||
  Boolean(
    buildCache &&
    typeof buildCache === 'object' &&
    (buildCache as InternalBuildCacheConfig)[
      DEFAULT_BUILD_CACHE_DIRECTORY_MARKER
    ],
  );

export const resolveBuildCacheDependencyPaths = <
  T extends {
    performance?: {
      buildCache?: boolean | RstestBuildCacheConfig;
    };
  },
>(
  config: T,
  configFilePath?: string,
): T => {
  const buildCache = config.performance?.buildCache;

  if (
    !configFilePath ||
    !buildCache ||
    buildCache === true ||
    !buildCache.buildDependencies?.length
  ) {
    return config;
  }

  const configDir = dirname(configFilePath);

  return {
    ...config,
    performance: {
      ...config.performance,
      buildCache: {
        ...buildCache,
        buildDependencies: buildCache.buildDependencies.map((filePath) =>
          isAbsolute(filePath) ? filePath : resolve(configDir, filePath),
        ),
      },
    },
  };
};

export const resolveProjectBuildCache = ({
  context,
  project,
}: {
  context: Pick<
    RstestContext,
    'rootPath' | 'configFilePath' | 'command' | 'normalizedConfig' | 'projects'
  >;
  project: Pick<
    ProjectContext,
    'environmentName' | 'configFilePath' | 'normalizedConfig'
  >;
}): false | RstestBuildCacheConfig =>
  normalizeBuildCache({
    buildCache: project.normalizedConfig.performance?.buildCache,
    root: project.normalizedConfig.root,
    configFilePath: project.configFilePath ?? context.configFilePath,
    tsconfigPaths: project.normalizedConfig.source?.tsconfigPath
      ? [project.normalizedConfig.source.tsconfigPath]
      : [],
    command: context.command,
    environmentName: project.environmentName,
    browserEnabled: project.normalizedConfig.browser.enabled,
    coverageEnabled: project.normalizedConfig.coverage?.enabled,
    coverageProvider: project.normalizedConfig.coverage?.provider,
    outputDistPathRoot: context.normalizedConfig.output.distPath.root,
    assumeNormalized: true,
  });

export const DEFAULT_CONFIG_EXTENSIONS = [
  '.mts',
  '.mjs',
  '.ts',
  '.js',
  '.cjs',
  '.cts',
] as const;

// Literal tuple kept private so `(typeof globalApiList)[number]` is the exact
// key union (the exported alias below is widened for consumers); `satisfies`
// rejects a *wrong* key here.
const globalApiList = [
  'test',
  'describe',
  'it',
  'expect',
  'afterAll',
  'afterEach',
  'beforeAll',
  'beforeEach',
  'rstest',
  'rs',
  'assert',
  'onTestFinished',
  'onTestFailed',
] as const satisfies readonly (keyof Rstest)[];

export const globalApis: readonly (keyof Rstest)[] = globalApiList;

/**
 * Exhaustiveness guard for {@link globalApis}. `satisfies` above rejects a
 * *wrong* key, but a short array still compiles — a new {@link Rstest} API
 * silently missing here is never registered onto `globalThis` under
 * `globals: true`. This alias resolves to a descriptive tuple (not `true`) when
 * any `Rstest` key is absent, failing the assignment below at compile time.
 */
type MissingGlobalApis = Exclude<keyof Rstest, (typeof globalApiList)[number]>;
type GlobalApisAreExhaustive = [MissingGlobalApis] extends [never]
  ? true
  : ['globalApis is missing keys of Rstest:', MissingGlobalApis];
const _globalApisAreExhaustive: GlobalApisAreExhaustive = true;
void _globalApisAreExhaustive;

/** Shared marker message for synthetic errors used only to capture a stack
 * trace. The value is a placeholder: the runner reads it back via
 * `error.message`, so every synthetic-stack site must use this same constant. */
export const SYNTHETIC_STACK_ERROR_MESSAGE = 'STACK_TRACE_ERROR';

/** Default per-test timeout (ms). Single source for the config default and any
 * downstream fallback. */
export const DEFAULT_TEST_TIMEOUT = 5_000;

export const TS_CONFIG_FILE = 'tsconfig.json';
