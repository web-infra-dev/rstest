import { dirname, isAbsolute, resolve } from 'node:path';
import { loadConfig, type RslibConfig, mergeRslibConfig } from '@rslib/core';
import type { ExtendConfig, ExtendConfigFn } from '@rstest/core';

export interface WithRslibConfigOptions {
  /**
   * `cwd` passed to loadConfig of Rslib
   * @default process.cwd()
   */
  cwd?: string;
  /**
   * Path to rslib config file
   * @default './rslib.config.ts'
   */
  configPath?: string;
  /**
   * The lib config id in `lib` field to use, will be merged with the other fields in the config.
   * Set to a string to use the lib config with matching id.
   * @default undefined
   */
  libId?: string;
  /**
   * Modify rslib config before converting to rstest config
   */
  modifyLibConfig?: (libConfig: RslibConfig) => RslibConfig;
}

type BuildCacheConfig = NonNullable<
  NonNullable<RslibConfig['performance']>['buildCache']
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
  if (isAbsolute(dependency)) {
    return dependency;
  }

  if (configPath) {
    return resolve(dirname(configPath), dependency);
  }

  return root ? resolve(root, dependency) : dependency;
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

export function withRslibConfig(
  options: WithRslibConfigOptions = {},
): ExtendConfigFn {
  return async (userConfig) => {
    const { configPath, modifyLibConfig, libId, cwd = process.cwd() } = options;

    // Load rslib config
    const {
      content: { lib, ...rawLibConfig },
      filePath,
    } = await loadConfig({
      cwd,
      path: configPath,
    });

    if (!filePath) {
      return {};
    }

    const libConfig =
      libId && Array.isArray(lib) ? lib.find((l) => l.id === libId) || {} : {};

    const libTestConfig = {
      source: libConfig.source,
      output: libConfig.output,
      tools: libConfig.tools,
      plugins: libConfig.plugins,
      resolve: libConfig.resolve,
    };

    const rslibConfig = Array.isArray(lib)
      ? (mergeRslibConfig(
          rawLibConfig as RslibConfig,
          libTestConfig as RslibConfig,
        ) as RslibConfig)
      : (rawLibConfig as RslibConfig);

    let libDecoratorsVersion = rslibConfig.source?.decorators?.version;

    if (
      !userConfig.source?.tsconfigPath &&
      !userConfig.source?.decorators?.version &&
      !libDecoratorsVersion
    ) {
      // support read decorators version from tsconfig
      const { loadTsconfig } = await import('./tsconfig');
      const tsconfig = await loadTsconfig(
        cwd,
        rslibConfig.source?.tsconfigPath,
      );

      if (tsconfig.compilerOptions?.experimentalDecorators) {
        libDecoratorsVersion = 'legacy';
      }
    }

    // Allow modification of rslib config
    const finalLibConfig = modifyLibConfig
      ? modifyLibConfig(rslibConfig)
      : rslibConfig;

    const { rspack, swc, bundlerChain } = finalLibConfig.tools || {};
    const { buildCache } = finalLibConfig.performance || {};
    const { cssModules, target } = finalLibConfig.output || {};
    const {
      assetsInclude,
      decorators,
      define,
      include,
      exclude,
      tsconfigPath,
      transformImport,
    } = finalLibConfig.source || {};

    // Convert rslib config to rstest config
    const rstestConfig = {
      // Copy over compatible configurations
      root: finalLibConfig.root,
      name: libId,
      plugins: finalLibConfig.plugins,
      source: {
        assetsInclude,
        decorators: {
          version: libDecoratorsVersion,
          ...decorators,
        },
        define,
        include,
        exclude,
        tsconfigPath,
        transformImport,
      },
      resolve: finalLibConfig.resolve,
      output: {
        cssModules,
        module: finalLibConfig.output?.module ?? libConfig.format !== 'cjs',
      },
      performance: {
        buildCache: updateCacheConfig({
          buildCache,
          configPath: filePath,
          root: finalLibConfig.root,
        }),
      },
      tools: {
        rspack,
        swc,
        bundlerChain,
      } as ExtendConfig['tools'],

      testEnvironment: target === 'web' ? 'happy-dom' : 'node',
    } as ExtendConfig;

    return rstestConfig;
  };
}
