import { normalize } from 'node:path';
import { mergeRsbuildConfig, type RsbuildConfig } from '@rsbuild/core';
import type { ExtendConfig } from '@rstest/core';
import {
  resolveBuildCache,
  resolveTestEnvironmentFromTarget,
} from '@rstest/core/internal/adapter';

/**
 * Convert rsbuild config to rstest config
 */
export function toRstestConfig({
  configPath,
  environmentName,
  rsbuildConfig: rawRsbuildConfig,
  modifyRsbuildConfig,
}: {
  configPath?: string;
  environmentName?: string;
  rsbuildConfig: RsbuildConfig;
  modifyRsbuildConfig?: (buildConfig: RsbuildConfig) => RsbuildConfig;
}): ExtendConfig {
  const { environments, ...rawBuildConfig } = rawRsbuildConfig;

  const environmentConfig = environmentName
    ? environments?.[environmentName]
    : undefined;

  const rsbuildConfig = environmentConfig
    ? mergeRsbuildConfig<RsbuildConfig>(
        rawBuildConfig as RsbuildConfig,
        environmentConfig as RsbuildConfig,
      )
    : (rawBuildConfig as RsbuildConfig);

  const finalBuildConfig = modifyRsbuildConfig
    ? modifyRsbuildConfig(rsbuildConfig)
    : rsbuildConfig;

  const { rspack, swc, bundlerChain } = finalBuildConfig.tools || {};
  const { buildCache } = finalBuildConfig.performance || {};
  const { cssModules, emitAssets, target, module } =
    finalBuildConfig.output || {};
  const {
    assetsInclude,
    decorators,
    define,
    include,
    exclude,
    tsconfigPath,
    transformImport,
  } = finalBuildConfig.source || {};

  const rstestConfig = {
    root: finalBuildConfig.root,
    name: environmentName,
    forceRerunTriggers: configPath ? [normalize(configPath)] : undefined,
    plugins: [
      ...(finalBuildConfig.plugins || []),
      // remove some plugins that are not needed or not compatible in test environment
      {
        name: 'rsbuild-adapter:remove-useless-plugins',
        remove: ['rsbuild:type-check'],
        setup: () => {},
      },
    ],
    source: {
      assetsInclude,
      decorators,
      define,
      include,
      exclude,
      tsconfigPath,
      transformImport,
    },
    resolve: finalBuildConfig.resolve,
    output: {
      cssModules,
      emitAssets,
      module,
    },
    performance: {
      buildCache: resolveBuildCache({
        buildCache,
        configPath,
        root: finalBuildConfig.root,
      }),
    },
    tools: {
      rspack,
      swc,
      bundlerChain,
    } as ExtendConfig['tools'],
    testEnvironment: resolveTestEnvironmentFromTarget(target),
  } as ExtendConfig;

  return rstestConfig;
}
