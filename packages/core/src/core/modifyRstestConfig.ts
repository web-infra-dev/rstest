import { existsSync } from 'node:fs';
import { join } from 'pathe';
import type {
  EnvironmentConfig,
  RsbuildConfig,
  RsbuildInstance,
} from '@rsbuild/core';
import { mergeRstestConfig } from '../config';
import type {
  EnvironmentWithOptions,
  ModifyRstestConfigCallback,
  NormalizedConfig,
  NormalizedProjectConfig,
  ProjectContext,
  RstestContext,
  RstestExposeAPI,
} from '../types';
import {
  castArray,
  ENV,
  formatRootStr,
  getAbsolutePath,
  getDefaultBuildCacheDir,
  getOutputDistPathRoot,
  getTempRstestOutputDirGlob,
  isDefaultBuildCache,
  isPlainObject,
  normalizeBuildCache,
  TS_CONFIG_FILE,
} from '../utils';

type RstestEnvironmentConfig = EnvironmentConfig & Pick<RsbuildConfig, 'root'>;

type NormalizedProjectConfigWithDistPath = NormalizedProjectConfig & {
  output?: NormalizedProjectConfig['output'] & {
    distPath?: NormalizedConfig['output']['distPath'];
  };
};

type MutableProjectConfigRuntimeShape = NormalizedProjectConfigWithDistPath &
  Record<string, unknown>;

type ForbiddenModifyRstestConfigPath = {
  path: string;
  get: (config: MutableProjectConfigRuntimeShape) => unknown;
};

// Keep runtime guards focused on a few high-risk fields that would change
// project identity or execution model in ways this hook cannot safely rewire.
// The remaining project-scoped fields are left to merge + normalization rather
// than maintaining a brittle allowlist for every possible config key.
const forbiddenModifyRstestConfigPaths: ForbiddenModifyRstestConfigPath[] = [
  {
    path: 'browser.enabled',
    get: (config) => config.browser?.enabled,
  },
  {
    path: 'name',
    get: (config) => config.name,
  },
  {
    path: 'coverage',
    get: (config) => config.coverage,
  },
  {
    path: 'isolate',
    get: (config) => config.isolate,
  },
  {
    path: 'pool',
    get: (config) => config.pool,
  },
  {
    path: 'reporters',
    get: (config) => config.reporters,
  },
  {
    path: 'update',
    get: (config) => config.update,
  },
  {
    path: 'output.distPath',
    get: (config) => config.output?.distPath,
  },
  {
    path: 'plugins',
    get: (config) => config.plugins,
  },
  {
    path: 'extends',
    get: (config) => config.extends,
  },
  {
    path: 'projects',
    get: (config) => config.projects,
  },
];

const clonePlainConfig = <T>(value: T): T => {
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

const isConfigValueEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((item, index) => isConfigValueEqual(item, right[index]))
    );
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);

    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(right, key) &&
          isConfigValueEqual(left[key], right[key]),
      )
    );
  }

  return false;
};

const getImmutableConfigChangeError = (key: string): Error => {
  if (key === 'browser.enabled') {
    return new Error(
      'Cannot modify `browser.enabled` in `modifyRstestConfig`. Configure Browser Mode in the Rstest project config instead.',
    );
  }

  if (key === 'name') {
    return new Error(
      'Cannot modify `name` in `modifyRstestConfig`. Configure the project name in the Rstest config instead.',
    );
  }

  return new Error(
    `Cannot modify \`${key}\` in \`modifyRstestConfig\`. Configure this option in the Rstest config instead.`,
  );
};

const getConfigKeys = (
  previousConfig: NormalizedProjectConfig,
  currentConfig: NormalizedProjectConfig,
): Array<keyof NormalizedProjectConfig> => {
  return Array.from(
    new Set([...Object.keys(previousConfig), ...Object.keys(currentConfig)]),
  ) as Array<keyof NormalizedProjectConfig>;
};

const preservePartialOutputDistPath = (
  previousConfig: NormalizedProjectConfig,
  currentConfig: NormalizedProjectConfig,
): void => {
  const currentOutput = currentConfig.output as
    ({ distPath?: unknown } & Record<string, unknown>) | undefined;
  if (
    !currentOutput ||
    Object.prototype.hasOwnProperty.call(currentOutput, 'distPath')
  ) {
    return;
  }

  const previousOutput = previousConfig.output as
    { distPath?: unknown } | undefined;
  if (previousOutput?.distPath) {
    currentOutput.distPath = previousOutput.distPath;
  }
};

const assertForbiddenConfigFields = (
  previousConfig: NormalizedProjectConfig,
  currentConfig: NormalizedProjectConfig,
): void => {
  const previousRuntimeConfig =
    previousConfig as MutableProjectConfigRuntimeShape;
  const currentRuntimeConfig =
    currentConfig as MutableProjectConfigRuntimeShape;

  for (const { path, get } of forbiddenModifyRstestConfigPaths) {
    if (
      !isConfigValueEqual(get(previousRuntimeConfig), get(currentRuntimeConfig))
    ) {
      throw getImmutableConfigChangeError(path);
    }
  }
};

const createMutableConfigOverrides = (
  previousConfig: NormalizedProjectConfig,
  currentConfig: NormalizedProjectConfig,
): Partial<NormalizedProjectConfig> => {
  const overrides: Partial<NormalizedProjectConfig> = {};

  for (const key of getConfigKeys(previousConfig, currentConfig)) {
    if (isConfigValueEqual(currentConfig[key], previousConfig[key])) {
      continue;
    }

    Object.assign(overrides, { [key]: currentConfig[key] });
  }

  return overrides;
};

const arrayReplacementKeys = [
  'setupFiles',
  'globalSetup',
  'includeSource',
] satisfies Array<keyof NormalizedProjectConfig>;

const normalizeRootPath = (root: string, baseRoot: string): string =>
  getAbsolutePath(baseRoot, formatRootStr(root, baseRoot));

const shouldRefreshDefaultBuildCacheRoot = (
  buildCache: NonNullable<NormalizedProjectConfig['performance']>['buildCache'],
  previousRoot: string,
  environmentName: string,
): boolean => {
  if (!buildCache) {
    return false;
  }

  if (buildCache === true) {
    return true;
  }

  const defaultCacheDir = getDefaultBuildCacheDir(environmentName);
  const previousDefaultCachePath = join(previousRoot, defaultCacheDir);

  return (
    isDefaultBuildCache(buildCache) ||
    buildCache.cacheDirectory === previousDefaultCachePath
  );
};

const normalizeRootDerivedConfigFields = (
  config: NormalizedProjectConfig,
  previousConfig: NormalizedProjectConfig,
  environmentName: string,
): void => {
  const root = config.root;
  if (!root || root === previousConfig.root) {
    return;
  }

  config.source ??= {};
  const previousTsconfigPath = previousConfig.source?.tsconfigPath;
  const currentTsconfigPath = config.source.tsconfigPath;
  const previousDefaultTsconfigPath = join(previousConfig.root, TS_CONFIG_FILE);
  if (
    !currentTsconfigPath ||
    (currentTsconfigPath === previousTsconfigPath &&
      (!previousTsconfigPath ||
        previousTsconfigPath === previousDefaultTsconfigPath))
  ) {
    const tsconfigPath = join(root, TS_CONFIG_FILE);
    config.source.tsconfigPath = existsSync(tsconfigPath)
      ? tsconfigPath
      : undefined;
  }

  if (
    shouldRefreshDefaultBuildCacheRoot(
      config.performance?.buildCache,
      previousConfig.root,
      environmentName,
    )
  ) {
    config.performance ??= {};
    config.performance.buildCache = true;
  }
};

const normalizeMutableConfigFields = (
  config: NormalizedProjectConfig,
  previousConfig: NormalizedProjectConfig,
  environmentName: string,
  context: RstestContext,
  configFilePath: string | undefined,
): void => {
  const configWithDistPath = config as NormalizedProjectConfigWithDistPath;
  const previousConfigWithDistPath =
    previousConfig as NormalizedProjectConfigWithDistPath;

  if (config.root) {
    config.root = normalizeRootPath(config.root, previousConfig.root);
  }
  if (config.source?.tsconfigPath) {
    config.source.tsconfigPath = getAbsolutePath(
      config.root,
      config.source.tsconfigPath,
    );
  }
  normalizeRootDerivedConfigFields(config, previousConfig, environmentName);

  config.setupFiles = castArray(config.setupFiles);
  config.globalSetup = castArray(config.globalSetup);
  config.exclude ??= {
    patterns: [],
    override: false,
  };

  const outputDistPathRoot = getOutputDistPathRoot(
    configWithDistPath.output?.distPath,
  );
  const previousOutputDistPathRoot = getOutputDistPathRoot(
    previousConfigWithDistPath.output?.distPath,
  );
  if (
    configWithDistPath.output?.distPath ||
    previousConfigWithDistPath.output?.distPath
  ) {
    config.output ??= {};
    configWithDistPath.output!.distPath = {
      root: formatRootStr(outputDistPathRoot, config.root),
    };
  }

  if (typeof config.testEnvironment === 'string') {
    config.testEnvironment = {
      name: config.testEnvironment,
    } satisfies EnvironmentWithOptions;
  }

  const buildCache = config.performance?.buildCache;
  if (buildCache) {
    config.performance ??= {};
    config.performance.buildCache = normalizeBuildCache({
      buildCache,
      root: config.root,
      configFilePath: configFilePath ?? context.configFilePath,
      tsconfigPaths: config.source?.tsconfigPath
        ? [config.source.tsconfigPath]
        : [],
      command: context.command,
      environmentName,
      browserEnabled: config.browser.enabled,
      coverageEnabled: config.coverage?.enabled,
      coverageProvider: config.coverage?.provider,
      outputDistPathRoot: context.normalizedConfig.output.distPath.root,
      assumeNormalized: true,
    });
  }

  const previousTempOutputGlob = getTempRstestOutputDirGlob(
    previousOutputDistPathRoot,
  );
  const tempOutputGlob = getTempRstestOutputDirGlob(
    configWithDistPath.output?.distPath?.root ?? outputDistPathRoot,
  );
  config.exclude.patterns = Array.from(
    new Set([
      ...config.exclude.patterns.filter(
        (pattern) => pattern !== previousTempOutputGlob,
      ),
      tempOutputGlob,
    ]),
  );
};

const syncProjectDerivedFields = (project: ProjectContext): void => {
  project.rootPath = project.normalizedConfig.root || project.rootPath;
  project.outputModule =
    project.normalizedConfig.output?.module ??
    process.env[ENV.OUTPUT_MODULE] !== 'false';
};

const applyModifyRstestConfig = async (
  config: NormalizedProjectConfig,
  context: RstestContext,
  project: ProjectContext,
  callbacks: ModifyRstestConfigCallback[],
): Promise<NormalizedProjectConfig> => {
  let currentConfig = config;

  for (const callback of callbacks) {
    const previousConfig = clonePlainConfig(currentConfig);
    const result = await callback(currentConfig);

    preservePartialOutputDistPath(previousConfig, currentConfig);
    assertForbiddenConfigFields(previousConfig, currentConfig);

    const mutatedOverrides = result
      ? undefined
      : createMutableConfigOverrides(previousConfig, currentConfig);
    const overrides = result ?? mutatedOverrides!;
    const arrayOverrides: Partial<NormalizedProjectConfig> = {};
    for (const key of arrayReplacementKeys) {
      if (key in overrides) {
        Object.assign(arrayOverrides, { [key]: overrides[key] });
      }
    }
    const mergeOverrides = {
      ...overrides,
    };
    for (const key of arrayReplacementKeys) {
      if (key in arrayOverrides) {
        Object.assign(mergeOverrides, { [key]: undefined });
      }
    }

    currentConfig = mergeRstestConfig(
      previousConfig,
      mergeOverrides,
    ) as NormalizedProjectConfig;
    Object.assign(currentConfig, arrayOverrides);
    normalizeMutableConfigFields(
      currentConfig,
      previousConfig,
      project.environmentName,
      context,
      project.configFilePath,
    );
    assertForbiddenConfigFields(previousConfig, currentConfig);
  }

  return currentConfig;
};

const applyProjectModifyRstestConfig = async (
  context: RstestContext,
  project: ProjectContext,
  callbacks: ModifyRstestConfigCallback[] | undefined,
): Promise<void> => {
  if (!callbacks?.length) {
    return;
  }

  const modifiedConfig = await applyModifyRstestConfig(
    project.normalizedConfig,
    context,
    project,
    callbacks,
  );
  Object.assign(project.normalizedConfig, modifiedConfig);
  syncProjectDerivedFields(project);
};

export const getRsbuildEnvironmentConfig = (
  project: ProjectContext,
): RstestEnvironmentConfig => ({
  plugins: project.normalizedConfig.plugins,
  root: project.rootPath,
  output: {
    target: 'node' as const,
  },
});

const createRstestExposeAPI = (
  environmentName: string,
  modifyRstestConfigCallbacks: Map<string, ModifyRstestConfigCallback[]>,
): RstestExposeAPI => ({
  modifyRstestConfig: (callback) => {
    const callbacks = modifyRstestConfigCallbacks.get(environmentName) ?? [];
    callbacks.push(callback);
    modifyRstestConfigCallbacks.set(environmentName, callbacks);
  },
});

export const initModifyRstestConfigHooks = (
  context: RstestContext,
  rsbuildInstance: RsbuildInstance,
  projects: ProjectContext[],
  exposeProjects: ProjectContext[] = projects,
  onModifyRstestConfigApplied?: () => Promise<void>,
): void => {
  const modifyRstestConfigCallbacks = new Map<
    string,
    ModifyRstestConfigCallback[]
  >();
  const appliedEnvironmentNames = new Set<string>();

  const applyModifyRstestConfigCallbacks = async () => {
    for (const project of exposeProjects) {
      if (appliedEnvironmentNames.has(project.environmentName)) {
        continue;
      }
      const callbacks = modifyRstestConfigCallbacks.get(
        project.environmentName,
      );
      if (!callbacks?.length) {
        continue;
      }
      await applyProjectModifyRstestConfig(context, project, callbacks);
      appliedEnvironmentNames.add(project.environmentName);
    }
  };

  for (const project of exposeProjects) {
    rsbuildInstance.expose(
      'rstest',
      createRstestExposeAPI(
        project.environmentName,
        modifyRstestConfigCallbacks,
      ),
      {
        environment: project.environmentName,
      },
    );
  }

  rsbuildInstance.modifyRsbuildConfig({
    order: 'pre',
    handler: async (config) => {
      await applyModifyRstestConfigCallbacks();
      await onModifyRstestConfigApplied?.();

      return {
        ...config,
        environments: Object.fromEntries(
          projects.map((project) => [
            project.environmentName,
            getRsbuildEnvironmentConfig(project),
          ]),
        ),
      };
    },
  });
};
