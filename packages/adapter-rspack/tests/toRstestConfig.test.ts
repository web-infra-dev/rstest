import type { RspackOptions } from '@rspack/core';
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
  });

  it('should extract tsconfigPath from resolve.tsConfig object', () => {
    const config = toRstestConfig({
      rspackConfig: {
        ...baseConfig,
        resolve: {
          tsConfig: { configFile: './tsconfig.build.json' },
        },
      },
    });

    expect(config.source?.tsconfigPath).toBe('./tsconfig.build.json');
  });

  it('should apply rspack module rules via tools.rspack', () => {
    const loaderRule = { test: /\.svg$/, type: 'asset/resource' as const };
    const config = toRstestConfig({
      rspackConfig: {
        ...baseConfig,
        module: { rules: [loaderRule] },
      },
    });

    const rspackFn = config.tools?.rspack as (
      config: Record<string, any>,
    ) => Record<string, any>;
    expect(rspackFn).toBeTypeOf('function');

    const result = rspackFn({ plugins: [] });
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

    const rspackFn = config.tools?.rspack as (
      config: Record<string, any>,
    ) => Record<string, any>;
    const result = rspackFn({ plugins: [] });
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

    const rspackFn = config.tools?.rspack as (
      config: Record<string, any>,
    ) => Record<string, any>;
    const result = rspackFn({});
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

    const rspackFn = config.tools?.rspack as (
      config: Record<string, any>,
    ) => Record<string, any>;
    const result = rspackFn({ plugins: [] });
    expect(result.plugins).toEqual([cssPlugin, otherPlugin]);
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

    const rspackFn = config.tools?.rspack as (
      config: Record<string, any>,
    ) => Record<string, any>;
    const result = rspackFn({ experiments: { asyncWebAssembly: true } });
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

    const rspackFn = config.tools?.rspack as (
      config: Record<string, any>,
    ) => Record<string, any>;
    const result = rspackFn({});
    expect(result.experiments).toEqual({ css: true });
  });
});
