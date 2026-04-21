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

export const TEMP_RSTEST_OUTPUT_DIR = 'dist/.rstest-temp';
const DEFAULT_BUILD_CACHE_PREFIX = 'node_modules/.cache/rstest';

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
  outputDistPathRoot?: string;
  assumeNormalized?: boolean;
};

const getDefaultBuildCacheDir = (environmentName?: string): string =>
  environmentName
    ? `${DEFAULT_BUILD_CACHE_PREFIX}-${environmentName}`
    : DEFAULT_BUILD_CACHE_PREFIX;

const isUsingDefaultBuildCacheDir = ({
  root,
  cacheDirectory,
  environmentName,
}: {
  root: string;
  cacheDirectory?: string;
  environmentName?: string;
}): boolean =>
  !cacheDirectory ||
  resolve(root, cacheDirectory) === resolve(root, DEFAULT_BUILD_CACHE_PREFIX) ||
  resolve(root, cacheDirectory) ===
    resolve(root, getDefaultBuildCacheDir(environmentName));

export const normalizeBuildCache = ({
  buildCache,
  root,
  configFilePath,
  projectConfigFilePaths = [],
  tsconfigPaths = [],
  command,
  environmentName,
  browserEnabled,
  outputDistPathRoot,
  assumeNormalized = false,
}: BuildCacheInput): false | RstestBuildCacheConfig => {
  if (!buildCache) {
    return false;
  }

  const userConfig = buildCache === true ? {} : buildCache;
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
      ? userConfig.cacheDigest.slice(5)
      : userConfig.cacheDigest || [];
  const cacheDigest = [
    'rstest',
    command,
    environmentName,
    browserEnabled ? 'browser' : 'node',
    outputDistPathRoot,
    ...userCacheDigest,
  ];

  const cacheDirectory = isUsingDefaultBuildCacheDir({
    root,
    cacheDirectory: userConfig.cacheDirectory,
    environmentName,
  })
    ? getDefaultBuildCacheDir(environmentName)
    : userConfig.cacheDirectory!;

  return {
    cacheDirectory: resolve(root, cacheDirectory),
    cacheDigest,
    buildDependencies,
  };
};

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
    root: context.rootPath,
    configFilePath: project.configFilePath || context.configFilePath,
    tsconfigPaths: project.normalizedConfig.source?.tsconfigPath
      ? [project.normalizedConfig.source.tsconfigPath]
      : [],
    command: context.command,
    environmentName: project.environmentName,
    browserEnabled: project.normalizedConfig.browser.enabled,
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

export const globalApis: (keyof Rstest)[] = [
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
];

export const TS_CONFIG_FILE = 'tsconfig.json';
