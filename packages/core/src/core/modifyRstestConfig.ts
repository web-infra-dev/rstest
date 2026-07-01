import { existsSync } from 'node:fs';
import type {
  EnvironmentConfig,
  RsbuildConfig,
  RsbuildInstance,
} from '@rsbuild/core';
import { join } from 'pathe';
import { mergeRstestConfig } from '../config';
import type {
  EnvironmentWithOptions,
  ModifyRstestConfigCallback,
  NormalizedProjectConfig,
  ProjectContext,
  RstestExposeAPI,
  RstestContext,
} from '../types';
import {
  castArray,
  ENV,
  formatRootStr,
  getAbsolutePath,
  isPlainObject,
  normalizeBuildCache,
  resolveBuildCacheDependencyPaths,
  TS_CONFIG_FILE,
} from '../utils';

type RstestEnvironmentConfig = EnvironmentConfig & Pick<RsbuildConfig, 'root'>;

const mutableModifyRstestConfigKeys = new Set<keyof NormalizedProjectConfig>([
  'root',
  'include',
  'exclude',
  'includeSource',
  'forceRerunTriggers',
  'setupFiles',
  'globalSetup',
  'retry',
  'passWithNoTests',
  'globals',
  'testEnvironment',
  'printConsoleTrace',
  'disableConsoleIntercept',
  'update',
  'hideSkippedTests',
  'hideSkippedTestFiles',
  'testNamePattern',
  'testTimeout',
  'hookTimeout',
  'clearMocks',
  'resetMocks',
  'restoreMocks',
  'slowTestThreshold',
  'detectAsyncLeaks',
  'unstubGlobals',
  'unstubEnvs',
  'maxConcurrency',
  'logHeapUsage',
  'snapshotFormat',
  'env',
  'performance',
  'chaiConfig',
  'includeTaskLocation',
  'source',
  'dev',
  'output',
  'resolve',
  'tools',
]);

const replaceMutatedConfigKeys = new Set<keyof NormalizedProjectConfig>([
  'setupFiles',
  'globalSetup',
  'includeSource',
  'forceRerunTriggers',
]);

const clonePlainConfig = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => clonePlainConfig(item)) as T;
  }

  if (isPlainObject(value)) {
    const cloned = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clonePlainConfig(item)]),
    );
    for (const symbol of Object.getOwnPropertySymbols(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, symbol);
      if (descriptor?.value !== undefined) {
        descriptor.value = clonePlainConfig(descriptor.value);
      }
      if (descriptor) {
        Object.defineProperty(cloned, symbol, descriptor);
      }
    }

    return cloned as T;
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
    `Cannot modify \`${key}\` in \`modifyRstestConfig\`. Configure global options in the Rstest config instead.`,
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

const assertMutableConfigFields = (
  previousConfig: NormalizedProjectConfig,
  currentConfig: NormalizedProjectConfig,
): void => {
  const previous = previousConfig as Record<string, unknown>;
  const current = currentConfig as Record<string, unknown>;

  if (
    !isConfigValueEqual(
      previousConfig.browser?.enabled,
      currentConfig.browser?.enabled,
    )
  ) {
    throw getImmutableConfigChangeError('browser.enabled');
  }

  for (const key of getConfigKeys(previousConfig, currentConfig)) {
    if (!isConfigValueEqual(current[key], previous[key])) {
      if (!mutableModifyRstestConfigKeys.has(key)) {
        throw getImmutableConfigChangeError(key);
      }
    }
  }

  const previousOutput = previous.output as { distPath?: unknown } | undefined;
  const currentOutput = current.output as { distPath?: unknown } | undefined;

  if (!isConfigValueEqual(previousOutput?.distPath, currentOutput?.distPath)) {
    throw getImmutableConfigChangeError('output.distPath');
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

    if (!mutableModifyRstestConfigKeys.has(key)) {
      throw getImmutableConfigChangeError(key);
    }

    Object.assign(overrides, { [key]: currentConfig[key] });
  }

  return overrides;
};

const applyReplacementConfigOverrides = (
  config: NormalizedProjectConfig,
  overrides: Partial<NormalizedProjectConfig>,
): void => {
  for (const key of replaceMutatedConfigKeys) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      Object.assign(config, { [key]: overrides[key] });
    }
  }
};

const syncRootDerivedConfigFields = (
  config: NormalizedProjectConfig,
  previousConfig: NormalizedProjectConfig,
  context: RstestContext,
  project: ProjectContext,
): void => {
  config.source ??= {};
  const previousDefaultTsconfigPath = join(previousConfig.root, TS_CONFIG_FILE);
  if (config.root !== previousConfig.root) {
    if (config.source.tsconfigPath === previousDefaultTsconfigPath) {
      delete config.source.tsconfigPath;
    }
    const buildCache = config.performance?.buildCache;
    if (buildCache && buildCache !== true) {
      const previousBuildCache = previousConfig.performance?.buildCache;
      if (
        previousBuildCache &&
        previousBuildCache !== true &&
        buildCache.cacheDirectory === previousBuildCache.cacheDirectory
      ) {
        delete buildCache.cacheDirectory;
      }
      if (buildCache.buildDependencies) {
        buildCache.buildDependencies = buildCache.buildDependencies.filter(
          (filePath) => filePath !== previousDefaultTsconfigPath,
        );
      }
    }
  }

  if (!config.source.tsconfigPath) {
    const tsconfigPath = join(config.root, TS_CONFIG_FILE);

    if (existsSync(tsconfigPath)) {
      config.source.tsconfigPath = tsconfigPath;
    }
  } else {
    config.source.tsconfigPath = getAbsolutePath(
      config.root,
      config.source.tsconfigPath,
    );
  }

  if (config.performance?.buildCache) {
    config.performance.buildCache = normalizeBuildCache({
      buildCache: config.performance.buildCache,
      root: config.root,
      configFilePath: project.configFilePath ?? context.configFilePath,
      tsconfigPaths: config.source.tsconfigPath
        ? [config.source.tsconfigPath]
        : [],
      command: context.command,
      environmentName: project.environmentName,
      browserEnabled: config.browser.enabled,
      coverageEnabled: config.coverage?.enabled,
      coverageProvider: config.coverage?.provider,
      outputDistPathRoot: context.normalizedConfig.output.distPath.root,
      assumeNormalized: true,
    });
  }
};

const normalizeMutableConfigFields = (
  config: NormalizedProjectConfig,
  baseRoot: string,
  previousConfig: NormalizedProjectConfig,
  context: RstestContext,
  project: ProjectContext,
): void => {
  if (config.root) {
    config.root = getAbsolutePath(
      baseRoot,
      formatRootStr(config.root, baseRoot),
    );
  }
  config.setupFiles = castArray(config.setupFiles);
  config.globalSetup = castArray(config.globalSetup);
  if (typeof config.testEnvironment === 'string') {
    config.testEnvironment = {
      name: config.testEnvironment,
    } satisfies EnvironmentWithOptions;
  }
  syncRootDerivedConfigFields(config, previousConfig, context, project);
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

    assertMutableConfigFields(previousConfig, currentConfig);

    const mutableOverrides = result
      ? undefined
      : createMutableConfigOverrides(previousConfig, currentConfig);

    currentConfig = mergeRstestConfig(
      resolveBuildCacheDependencyPaths(
        previousConfig,
        project.configFilePath ?? context.configFilePath,
      ),
      result ?? mutableOverrides ?? {},
    ) as NormalizedProjectConfig;
    if (mutableOverrides) {
      applyReplacementConfigOverrides(currentConfig, mutableOverrides);
    }
    normalizeMutableConfigFields(
      currentConfig,
      previousConfig.root,
      previousConfig,
      context,
      project,
    );
    assertMutableConfigFields(previousConfig, currentConfig);
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
  if (project.normalizedConfig.update) {
    context.snapshotManager.options.updateSnapshot = 'all';
  }
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
  rsbuildInstance: RsbuildInstance,
  context: RstestContext,
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
