import { isAbsolute, join, normalize } from 'node:path';
import { loadConfig, type RslibConfig, mergeRslibConfig } from '@rslib/core';
import type { ExtendConfig, ExtendConfigFn } from '@rstest/core';
import { resolveBuildCache } from '@rstest/core/internal/adapter';

export interface WithRslibConfigOptions {
  /**
   * Rslib config object to convert directly.
   * When provided, `configPath` is only used as file metadata.
   * @default undefined
   */
  config?: RslibConfig;
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

export function withRslibConfig(
  options: WithRslibConfigOptions = {},
): ExtendConfigFn {
  return async (userConfig) => {
    const {
      config: inlineConfig,
      configPath,
      modifyLibConfig,
      libId,
      cwd = process.cwd(),
    } = options;

    let rslibConfig: RslibConfig;
    let filePath: string | undefined;

    if (inlineConfig) {
      rslibConfig = inlineConfig;
      if (configPath) {
        filePath = configPath;
        if (!isAbsolute(configPath)) {
          filePath = join(cwd, configPath);
        }
      }
    } else {
      const loadedConfig = await loadConfig({
        cwd,
        path: configPath,
      });
      rslibConfig = loadedConfig.content;
      if (loadedConfig.filePath) {
        filePath = loadedConfig.filePath;
      }
    }

    if (!filePath && !inlineConfig) {
      return {};
    }

    const { lib, ...rawLibConfig } = rslibConfig;

    const libConfig =
      libId && Array.isArray(lib) ? lib.find((l) => l.id === libId) || {} : {};

    const libTestConfig = {
      source: libConfig.source,
      output: libConfig.output,
      tools: libConfig.tools,
      plugins: libConfig.plugins,
      resolve: libConfig.resolve,
    };

    const mergedRslibConfig = Array.isArray(lib)
      ? (mergeRslibConfig(
          rawLibConfig as RslibConfig,
          libTestConfig as RslibConfig,
        ) as RslibConfig)
      : (rawLibConfig as RslibConfig);

    let libDecoratorsVersion = mergedRslibConfig.source?.decorators?.version;

    if (
      !userConfig.source?.tsconfigPath &&
      !userConfig.source?.decorators?.version &&
      !libDecoratorsVersion
    ) {
      // support read decorators version from tsconfig
      const { loadTsconfig } = await import('./tsconfig');
      const tsconfig = await loadTsconfig(
        cwd,
        mergedRslibConfig.source?.tsconfigPath,
      );

      if (tsconfig.compilerOptions?.experimentalDecorators) {
        libDecoratorsVersion = 'legacy';
      }
    }

    // Allow modification of rslib config
    const finalLibConfig = modifyLibConfig
      ? modifyLibConfig(mergedRslibConfig)
      : mergedRslibConfig;

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
      forceRerunTriggers: filePath ? [normalize(filePath)] : undefined,
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
        buildCache: resolveBuildCache({
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

      // rslib builds libraries, which are Node-first: only an explicit `web`
      // target maps to a browser env, everything else (including no target)
      // defaults to `node`. This is the inverse of the rsbuild/rspack adapters'
      // `resolveTestEnvironmentFromTarget` default, so this rule stays local.
      testEnvironment: target === 'web' ? 'happy-dom' : 'node',
    } as ExtendConfig;

    return rstestConfig;
  };
}
