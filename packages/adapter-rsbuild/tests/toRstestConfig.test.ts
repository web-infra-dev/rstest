import { defineConfig, type RsbuildConfig } from '@rsbuild/core';
import { describe, expect, it } from '@rstest/core';
import { toRstestConfig } from '../src';

describe('toRstestConfig', () => {
  const rsbuildConfig = defineConfig({
    source: {
      assetsInclude: /\.json5$/,
      define: {
        'process.env.NODE_ENV': '"common"',
      },
      transformImport: [
        {
          libraryName: 'lodash',
          libraryDirectory: '',
          camelToDashComponentName: false,
        },
      ],
    },
    resolve: {
      alias: {
        '@': './src',
      },
      conditionNames: ['custom', 'import'],
      mainFields: ['module', 'main'],
    },
    environments: {
      test: {
        source: {
          define: {
            'process.env.NODE_ENV': '"test"',
          },
        },
      },
      node: {
        output: {
          target: 'node',
        },
      },
    },
  }) as RsbuildConfig;

  it('should convert rsbuild config to rstest config', () => {
    const config = toRstestConfig({ rsbuildConfig });

    expect(config.source?.assetsInclude).toEqual(/\.json5$/);
    expect(config.source?.define).toEqual({
      'process.env.NODE_ENV': '"common"',
    });
    expect(config.source?.transformImport).toEqual([
      {
        libraryName: 'lodash',
        libraryDirectory: '',
        camelToDashComponentName: false,
      },
    ]);
    expect(config.resolve?.alias).toEqual({
      '@': './src',
    });
    expect(config.resolve?.conditionNames).toEqual(['custom', 'import']);
    expect(config.resolve?.mainFields).toEqual(['module', 'main']);
    expect(config.testEnvironment).toBe('happy-dom');
  });

  it('should merge environment config', () => {
    const config = toRstestConfig({
      rsbuildConfig,
      environmentName: 'test',
    });

    expect(config.name).toBe('test');
    expect(config.source?.assetsInclude).toEqual(/\.json5$/);
    expect(config.source?.define).toEqual({
      'process.env.NODE_ENV': '"test"',
    });
    expect(config.resolve?.alias).toEqual({
      '@': './src',
    });
    expect(config.resolve?.conditionNames).toEqual(['custom', 'import']);
    expect(config.resolve?.mainFields).toEqual(['module', 'main']);
  });

  it('should map node target to node test environment', () => {
    const config = toRstestConfig({
      rsbuildConfig,
      environmentName: 'node',
    });

    expect(config.name).toBe('node');
    expect(config.testEnvironment).toBe('node');
  });

  it('should allow modification of rsbuild config', () => {
    const config = toRstestConfig({
      rsbuildConfig,
      modifyRsbuildConfig: (buildConfig) => ({
        ...buildConfig,
        source: {
          ...buildConfig.source,
          define: {
            ...buildConfig.source?.define,
            'process.env.CUSTOM': '"custom-value"',
          },
        },
      }),
    });

    expect(config.source?.define).toEqual({
      'process.env.NODE_ENV': '"common"',
      'process.env.CUSTOM': '"custom-value"',
    });
  });
});
