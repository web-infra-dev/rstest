import { isAbsolute } from 'node:path';
import {
  dirname as posixDirname,
  resolve as posixResolve,
} from 'node:path/posix';
import { mergeRsbuildConfig, type RsbuildConfig } from '@rsbuild/core';
import type { ExtendConfig } from '@rstest/core';

type BuildCacheConfig = NonNullable<
  NonNullable<RsbuildConfig['performance']>['buildCache']
>;
type BuildCacheOutput =
  | boolean
  | {
      cacheDirectory?: string;
      cacheDigest?: Array<string | undefined>;
      buildDependencies?: string[];
    }
  | undefined;

const getCacheDependency = ({
  dependency,
  configPath,
  root,
}: {
  dependency: string;
  configPath?: string;
  root?: string;
}): string => {
  // Use posix paths for consistency across platforms
  if (isAbsolute(dependency)) {
    return dependency.replaceAll('\\', '/');
  }

  if (configPath) {
    return posixResolve(
      posixDirname(configPath.replaceAll('\\', '/')),
      dependency,
    );
  }

  return root
    ? posixResolve(root.replaceAll('\\', '/'), dependency)
    : dependency;
};

const updateCacheConfig = ({
  buildCache,
  configPath,
  root,
}: {
  buildCache?: BuildCacheConfig;
  configPath?: string;
  root?: string;
}): BuildCacheOutput => {
  if (buildCache === undefined) {
    return undefined;
  }

  if (buildCache === false) {
    return false;
  }

  if (buildCache === true) {
    return configPath ? { buildDependencies: [configPath] } : true;
  }

  const buildDependencies = buildCache.buildDependencies?.map((dependency) =>
    getCacheDependency({
      dependency,
      configPath,
      root,
    }),
  );
  const nextBuildDependencies = configPath
    ? Array.from(new Set([...(buildDependencies || []), configPath]))
    : buildDependencies;

  return {
    cacheDirectory: buildCache.cacheDirectory,
    cacheDigest: buildCache.cacheDigest,
    buildDependencies: nextBuildDependencies,
  };
};

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
      buildCache: updateCacheConfig({
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
    testEnvironment: target === 'node' ? 'node' : 'happy-dom',
  } as ExtendConfig;

  return rstestConfig;
}
