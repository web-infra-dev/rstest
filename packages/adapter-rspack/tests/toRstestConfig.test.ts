import { normalize, resolve } from 'node:path';
import type { Configuration, RspackOptions } from '@rspack/core';
import { describe, expect, it } from '@rstest/core';
import { toRstestConfig } from '../src';

const baseConfig: RspackOptions = {
  name: 'base',
  target: 'web',
  output: {
    module: true,
  },
};

const nodeConfig: RspackOptions = {
  name: 'node',
  target: 'node',
  output: {
    module: false,
  },
};

const generatedCache = {
  type: 'persistent',
  version: 'rstest-version',
  storage: {
    type: 'filesystem',
    directory: '/repo/project/.cache/rstest',
  },
  buildDependencies: ['/repo/project/rstest.config.ts'],
} satisfies NonNullable<Configuration['cache']>;

const mergeRspackConfig = (
  firstConfiguration: Configuration | Configuration[],
  ...configurations: Configuration[]
): Configuration => {
  const configs = [
    ...(Array.isArray(firstConfiguration)
      ? firstConfiguration
      : [firstConfiguration]),
    ...configurations,
  ];
  const merged = Object.assign({}, ...configs);
  const resolveConfigs = configs.flatMap((config) =>
    config.resolve ? [config.resolve] : [],
  );

  if (resolveConfigs.length) {
    merged.resolve = Object.assign({}, ...resolveConfigs);
  }

  return merged;
};

const applyRspackTool = (
  config: ReturnType<typeof toRstestConfig>,
  rspackConfig: Configuration = { cache: generatedCache },
): Configuration => {
  // The public tools type also permits a config object, while this adapter
  // always returns the callback form.
  const rspackFn = config.tools?.rspack as (
    config: Configuration,
    utils: { mergeConfig: typeof mergeRspackConfig },
  ) => Configuration;
  return rspackFn(rspackConfig, { mergeConfig: mergeRspackConfig });
};

describe('toRstestConfig', () => {
  it('should convert rspack config to rstest config', () => {
    const config = toRstestConfig({
      rspackConfig: baseConfig,
    });

    expect(config.name).toBe('base');
    expect(config.output).toEqual({ module: true });
    expect(config.testEnvironment).toBe('happy-dom');
    expect(config.tools?.rspack).toBeDefined();
  });

  it('should map node target to node test environment', () => {
    const config = toRstestConfig({
      rspackConfig: nodeConfig,
    });

    expect(config.name).toBe('node');
    expect(config.testEnvironment).toBe('node');
  });

  it('should allow modification of rspack config', () => {
    const config = toRstestConfig({
      rspackConfig: baseConfig,
      modifyRspackConfig: (config) => ({
        ...config,
        output: {
          ...config.output,
          module: false,
        },
      }),
    });

    expect(config.output).toEqual({ module: false });
  });

  it('should respect configName', () => {
    const config = toRstestConfig({
      rspackConfig: baseConfig,
      configName: 'custom',
    });

    expect(config.name).toBe('custom');
  });

  it('should convert persistent cache config to build cache config', () => {
    const config = toRstestConfig({
      rspackConfig: {
        ...baseConfig,
        context: '/repo/project',
        cache: {
          type: 'persistent',
          name: 'client',
          version: 'rspack-version',
          storage: {
            type: 'filesystem',
            directory: '.cache/from-rspack',
          },
          buildDependencies: ['./rspack-extra.ts'],
        },
      },
      configPath: '/repo/configs/rspack.config.ts',
    });

    expect(config.performance?.buildCache).toEqual({
      cacheDirectory: resolve('/repo/project/.cache/from-rspack'),
      cacheDigest: ['rspack-version'],
      buildDependencies: [
        resolve('/repo/project/rspack-extra.ts'),
        normalize('/repo/configs/rspack.config.ts'),
      ],
    });
    expect(applyRspackTool(config).cache).toEqual({
      ...generatedCache,
      storage: {
        ...generatedCache.storage,
        location: resolve('/repo/project/.cache/from-rspack/client'),
      },
    });
    expect(config.forceRerunTriggers).toEqual([
      normalize('/repo/configs/rspack.config.ts'),
    ]);
  });

  it('should prefer the persistent cache location over directory and name', () => {
    const config = toRstestConfig({
      rspackConfig: {
        ...baseConfig,
        context: '/repo/project',
        cache: {
          type: 'persistent',
          name: 'client',
          storage: {
            type: 'filesystem',
            directory: '.cache/from-rspack',
            location: '.cache/exact',
          },
        },
      },
    });

    expect(config.performance?.buildCache).toEqual({
      cacheDirectory: resolve('/repo/project/.cache/from-rspack'),
      cacheDigest: undefined,
      buildDependencies: undefined,
    });
    expect(applyRspackTool(config).cache).toEqual({
      ...generatedCache,
      storage: {
        ...generatedCache.storage,
        location: resolve('/repo/project/.cache/exact'),
      },
    });
  });

  it('should derive the default persistent cache name', () => {
    const config = toRstestConfig({
      rspackConfig: {
        ...baseConfig,
        context: '/repo/project',
        cache: {
          type: 'persistent',
          storage: {
            type: 'filesystem',
            directory: '.cache/from-rspack',
          },
        },
      },
    });

    expect(config.performance?.buildCache).toEqual({
      cacheDirectory: resolve('/repo/project/.cache/from-rspack'),
      cacheDigest: undefined,
      buildDependencies: undefined,
    });
    expect(applyRspackTool(config).cache).toEqual({
      ...generatedCache,
      storage: {
        ...generatedCache.storage,
        location: resolve('/repo/project/.cache/from-rspack/base-production'),
      },
    });
  });

  it('should preserve a persistent cache name with the default directory', () => {
    const config = toRstestConfig({
      rspackConfig: {
        ...baseConfig,
        context: '/repo/project',
        cache: {
          type: 'persistent',
          name: 'client',
        },
      },
    });

    expect(config.performance?.buildCache).toEqual({
      cacheDirectory: resolve('/repo/project/node_modules/.cache/rspack'),
      cacheDigest: undefined,
      buildDependencies: undefined,
    });
    expect(applyRspackTool(config).cache).toEqual({
      ...generatedCache,
      storage: {
        ...generatedCache.storage,
        location: resolve('/repo/project/node_modules/.cache/rspack/client'),
      },
    });
  });

  it('should preserve the default persistent cache location', () => {
    const config = toRstestConfig({
      rspackConfig: {
        ...baseConfig,
        cache: {
          type: 'persistent',
          version: 'rspack-version',
          buildDependencies: ['./rspack-extra.ts'],
        },
      },
    });

    const result = applyRspackTool(config);
    expect(result.cache).toEqual({
      ...generatedCache,
      storage: {
        ...generatedCache.storage,
        location: resolve('node_modules/.cache/rspack/base-production'),
      },
    });
  });

  it('should extract resolve config', () => {
    const config = toRstestConfig({
      rspackConfig: {
        ...baseConfig,
        resolve: {
          alias: { '@src': '/path/to/src' },
          extensions: ['.ts', '.tsx', '.js'],
        },
      },
    });

    expect(config.resolve).toEqual({
      alias: { '@src': '/path/to/src' },
      extensions: ['.ts', '.tsx', '.js'],
    });
  });

  it('should pass Rspack-only resolve options to the compiler', () => {
    const config = toRstestConfig({
      rspackConfig: {
        resolve: {
          alias: { '@src': '/path/to/src' },
          extensions: ['.ts', '.js'],
          fallback: { stream: false },
          preferRelative: true,
        },
      },
    });

    expect(config.resolve).toEqual({
      alias: { '@src': '/path/to/src' },
      extensions: ['.ts', '.js'],
    });
    expect(
      applyRspackTool(config, {
        resolve: { extensionAlias: { '.js': ['.js', '.ts'] } },
      }).resolve,
    ).toEqual({
      extensionAlias: { '.js': ['.js', '.ts'] },
      fallback: { stream: false },
      preferRelative: true,
    });
  });

  it('should apply Rspack resolve.alias false at the compiler layer', () => {
    const config = toRstestConfig({
      rspackConfig: {
        resolve: { alias: false },
      },
    });

    expect(config.resolve).toBeUndefined();
    expect(
      applyRspackTool(config, {
        resolve: { alias: { '@generated': '/generated' } },
      }).resolve,
    ).toEqual({ alias: false });
  });

  it('should extract tsconfigPath from resolve.tsConfig string', () => {
    const config = toRstestConfig({
      rspackConfig: {
        ...baseConfig,
        resolve: {
          tsConfig: './tsconfig.json',
        },
      },
    });

    expect(config.source?.tsconfigPath).toBe('./tsconfig.json');
    expect(
      applyRspackTool(config, {
        resolve: {
          tsConfig: {
            configFile: './tsconfig.json',
            references: 'auto',
          },
        },
      }).resolve?.tsConfig,
    ).toBe('./tsconfig.json');
  });

  it('should preserve resolve.tsConfig references at the compiler layer', () => {
    const config = toRstestConfig({
      rspackConfig: {
        ...baseConfig,
        resolve: {
          tsConfig: {
            configFile: './tsconfig.build.json',
            references: ['./packages/client'],
          },
        },
      },
    });

    expect(config.source?.tsconfigPath).toBe('./tsconfig.build.json');
    expect(
      applyRspackTool(config, {
        resolve: {
          tsConfig: {
            configFile: './tsconfig.build.json',
            references: 'auto',
          },
        },
      }).resolve?.tsConfig,
    ).toEqual({
      configFile: './tsconfig.build.json',
      references: ['./packages/client'],
    });
  });

  it('should apply rspack module rules via tools.rspack', () => {
    const loaderRule = { test: /\.svg$/, type: 'asset/resource' as const };
    const config = toRstestConfig({
      rspackConfig: {
        ...baseConfig,
        module: { rules: [loaderRule] },
      },
    });

    const result = applyRspackTool(config, { plugins: [] });
    expect(result.module?.rules).toEqual([loaderRule]);
  });

  it('should filter HtmlRspackPlugin', () => {
    class HtmlRspackPlugin {
      apply() {}
    }
    const htmlPlugin = new HtmlRspackPlugin();
    const otherPlugin = { apply() {} };

    const config = toRstestConfig({
      rspackConfig: {
        ...baseConfig,
        plugins: [htmlPlugin, otherPlugin],
      },
    });

    const result = applyRspackTool(config, { plugins: [] });
    expect(result.plugins).toEqual([otherPlugin]);
  });

  it('should keep user CSS rules as-is', () => {
    const cssRule = { test: /\.css$/, type: 'css' };
    const cssAutoRule = { test: /\.css$/, type: 'css/auto' };
    const svgRule = { test: /\.svg$/, type: 'asset/resource' as const };
    const config = toRstestConfig({
      rspackConfig: {
        ...baseConfig,
        module: { rules: [cssRule, cssAutoRule, svgRule] },
      },
    });

    const result = applyRspackTool(config, {});
    expect(result.module?.rules).toEqual([cssRule, cssAutoRule, svgRule]);
  });

  it('should keep user plugins including CssExtractRspackPlugin', () => {
    class CssExtractRspackPlugin {
      apply() {}
    }
    const cssPlugin = new CssExtractRspackPlugin();
    const otherPlugin = { apply() {} };

    const config = toRstestConfig({
      rspackConfig: {
        ...baseConfig,
        plugins: [cssPlugin, otherPlugin],
      },
    });

    const result = applyRspackTool(config, { plugins: [] });
    expect(result.plugins).toEqual([cssPlugin, otherPlugin]);
  });

  it('should pass through compatible Rspack options', () => {
    const config = toRstestConfig({
      rspackConfig: {
        amd: { jQuery: true },
        externals: { react: 'react' },
        externalsType: 'commonjs',
        ignoreWarnings: [/ignore-me/],
        incremental: 'safe',
        infrastructureLogging: { level: 'verbose' },
        loader: { answer: 42 },
        resolveLoader: { modules: ['/custom/loaders'] },
      },
    });

    expect(applyRspackTool(config, {})).toEqual({
      amd: { jQuery: true },
      externals: { react: 'react' },
      externalsType: 'commonjs',
      ignoreWarnings: [/ignore-me/],
      incremental: 'safe',
      infrastructureLogging: { level: 'verbose' },
      loader: { answer: 42 },
      resolveLoader: { modules: ['/custom/loaders'] },
    });
  });

  it('should preserve framework-owned Rspack options', () => {
    const config = toRstestConfig({
      rspackConfig: {
        bail: true,
        dependencies: ['client'],
        devServer: false,
        entry: './src/index.ts',
        extends: './rspack.base.ts',
        lazyCompilation: true,
        mode: 'development',
        node: { __dirname: 'mock' },
        performance: { hints: 'error' },
        stats: 'none',
        watch: true,
      },
    });

    expect(
      applyRspackTool(config, {
        bail: false,
        entry: './rstest-entry.ts',
        mode: 'production',
        node: { __dirname: false },
        performance: { hints: false },
        stats: 'errors-only',
        watch: false,
      }),
    ).toEqual({
      bail: false,
      entry: './rstest-entry.ts',
      mode: 'production',
      node: { __dirname: false },
      performance: { hints: false },
      stats: 'errors-only',
      watch: false,
    });
  });

  it('should merge Rspack options while preserving test build invariants', () => {
    const config = toRstestConfig({
      rspackConfig: {
        devtool: 'inline-source-map',
        externalsPresets: { web: true },
        optimization: { moduleIds: 'deterministic' },
        output: {
          path: '/user-output',
          uniqueName: 'user-build',
        },
        watchOptions: { aggregateTimeout: 500 },
      },
    });

    expect(
      applyRspackTool(config, {
        devtool: 'nosources-source-map',
        externalsPresets: { node: false },
        optimization: { runtimeChunk: 'single' },
        output: { path: '/rstest-output', iife: false },
        watchOptions: { ignored: '**/**' },
      }),
    ).toEqual({
      devtool: 'inline-source-map',
      externalsPresets: { node: false, web: true },
      optimization: {
        moduleIds: 'deterministic',
        runtimeChunk: 'single',
      },
      output: {
        iife: false,
        path: '/rstest-output',
        uniqueName: 'user-build',
      },
      watchOptions: { aggregateTimeout: 500, ignored: '**/**' },
    });
  });

  it('should not include output when no module is set', () => {
    const config = toRstestConfig({
      rspackConfig: { name: 'no-output', target: 'web' },
    });

    expect(config.output).toBeUndefined();
  });

  it('should handle async-node target', () => {
    const config = toRstestConfig({
      rspackConfig: { target: 'async-node' },
    });

    expect(config.testEnvironment).toBe('node');
  });

  it('should handle array target', () => {
    const config = toRstestConfig({
      rspackConfig: { target: ['web', 'es5'] },
    });

    expect(config.testEnvironment).toBe('happy-dom');
  });

  it('should merge experiments via tools.rspack', () => {
    const config = toRstestConfig({
      rspackConfig: {
        ...baseConfig,
        experiments: { css: true },
      },
    });

    const result = applyRspackTool(config, {
      experiments: { asyncWebAssembly: true },
    });
    expect(result.experiments).toEqual({
      asyncWebAssembly: true,
      css: true,
    });
  });

  it('should filter out top-level lazyCompilation', () => {
    const config = toRstestConfig({
      rspackConfig: {
        ...baseConfig,
        lazyCompilation: true,
        experiments: { css: true },
      } as RspackOptions,
    });

    const result = applyRspackTool(config, {});
    expect(result.experiments).toEqual({ css: true });
  });
});
