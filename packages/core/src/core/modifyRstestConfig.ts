import type {
  EnvironmentConfig,
  RsbuildConfig,
  RsbuildInstance,
} from '@rsbuild/core';
import { mergeRstestConfig } from '../config';
import type {
  EnvironmentWithOptions,
  ModifyRstestConfigCallback,
  NormalizedProjectConfig,
  ProjectContext,
  RstestExposeAPI,
} from '../types';
import {
  castArray,
  ENV,
  formatRootStr,
  getAbsolutePath,
  isPlainObject,
} from '../utils';

type RstestEnvironmentConfig = EnvironmentConfig & Pick<RsbuildConfig, 'root'>;

const immutableModifyRstestConfigKeys = new Set<string>([
  'browser',
  'bail',
  'coverage',
  'extends',
  'isolate',
  'onConsoleLog',
  'pool',
  'plugins',
  'projects',
  'reporters',
  'resolveSnapshotPath',
  'silent',
]);

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

  return new Error(
    `Cannot modify \`${key}\` in \`modifyRstestConfig\`. Configure global options in the Rstest config instead.`,
  );
};

const assertImmutableConfigFields = (
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

  for (const key of immutableModifyRstestConfigKeys) {
    if (!isConfigValueEqual(current[key], previous[key])) {
      throw getImmutableConfigChangeError(key);
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

  for (const key of Object.keys(currentConfig) as Array<
    keyof NormalizedProjectConfig
  >) {
    if (isConfigValueEqual(currentConfig[key], previousConfig[key])) {
      continue;
    }

    if (immutableModifyRstestConfigKeys.has(key)) {
      throw getImmutableConfigChangeError(key);
    }

    Object.assign(overrides, { [key]: currentConfig[key] });
  }

  return overrides;
};

const normalizeMutableConfigFields = (
  config: NormalizedProjectConfig,
  baseRoot: string,
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
};

const syncProjectDerivedFields = (project: ProjectContext): void => {
  project.rootPath = project.normalizedConfig.root || project.rootPath;
  project.outputModule =
    project.normalizedConfig.output?.module ??
    process.env[ENV.OUTPUT_MODULE] !== 'false';
};

const applyModifyRstestConfig = async (
  config: NormalizedProjectConfig,
  callbacks: ModifyRstestConfigCallback[],
): Promise<NormalizedProjectConfig> => {
  let currentConfig = config;

  for (const callback of callbacks) {
    const previousConfig = clonePlainConfig(currentConfig);
    const result = await callback(currentConfig);

    assertImmutableConfigFields(previousConfig, currentConfig);

    currentConfig = mergeRstestConfig(
      previousConfig,
      result || createMutableConfigOverrides(previousConfig, currentConfig),
    ) as NormalizedProjectConfig;
    normalizeMutableConfigFields(currentConfig, previousConfig.root);
    assertImmutableConfigFields(previousConfig, currentConfig);
  }

  return currentConfig;
};

const applyProjectModifyRstestConfig = async (
  project: ProjectContext,
  callbacks: ModifyRstestConfigCallback[] | undefined,
): Promise<void> => {
  if (!callbacks?.length) {
    return;
  }

  const modifiedConfig = await applyModifyRstestConfig(
    project.normalizedConfig,
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
      await applyProjectModifyRstestConfig(project, callbacks);
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
