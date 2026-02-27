import { defineConfig, type RsbuildConfig } from '@rsbuild/core';
import { describe, expect, it } from '@rstest/core';
import { toRstestConfig } from '../src';

describe('toRstestConfig', () => {
  const rsbuildConfig = defineConfig({
    source: {
      define: {
        'process.env.NODE_ENV': '"common"',
      },
    },
    resolve: {
      alias: {
        '@': './src',
      },
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

    expect(config.source?.define).toEqual({
      'process.env.NODE_ENV': '"common"',
    });
    expect(config.resolve?.alias).toEqual({
      '@': './src',
    });
    expect(config.testEnvironment).toBe('happy-dom');
  });

  it('should merge environment config', () => {
    const config = toRstestConfig({
      rsbuildConfig,
      environmentName: 'test',
    });

    expect(config.name).toBe('test');
    expect(config.source?.define).toEqual({
      'process.env.NODE_ENV': '"test"',
    });
    expect(config.resolve?.alias).toEqual({
      '@': './src',
    });
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
