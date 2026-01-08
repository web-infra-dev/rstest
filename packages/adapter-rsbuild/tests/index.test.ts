import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@rstest/core';
import { withRsbuildConfig } from '../src';

describe('withRsbuildConfig', () => {
  const testConfigPath = join(__dirname, 'test-temp-rsbuild.config.ts');
  const testConfigContent = `
import { defineConfig } from '@rsbuild/core';

export default defineConfig({
  source: {
    define: {
      'process.env.NODE_ENV': '"common"'
    }
  },
  resolve: {
    alias: {
      '@': './src'
    }
  },
  environments: {
    test: {
      source: {
        define: {
          'process.env.NODE_ENV': '"test"'
        }
      }
    }
  }
});
  `;

  beforeEach(() => {
    // Create a temporary rsbuild config file for testing
    writeFileSync(testConfigPath, testConfigContent);
  });

  afterEach(() => {
    // Clean up test config file
    if (existsSync(testConfigPath)) {
      unlinkSync(testConfigPath);
    }
  });

  it('should load and convert rsbuild config to rstest config', async () => {
    const config = await withRsbuildConfig({
      configPath: testConfigPath,
    })({});

    expect(config).toBeDefined();
    expect(config.source?.define).toEqual({
      'process.env.NODE_ENV': '"common"',
    });
    expect(config.resolve?.alias).toEqual({
      '@': './src',
    });
    expect(config.testEnvironment).toBe('happy-dom');
  });

  it('should load and merge environment config', async () => {
    const config = await withRsbuildConfig({
      configPath: testConfigPath,
      environmentName: 'test',
    })({});

    expect(config).toBeDefined();
    expect(config.name).toBe('test');
    expect(config.source?.define).toEqual({
      'process.env.NODE_ENV': '"test"',
    });
    expect(config.resolve?.alias).toEqual({
      '@': './src',
    });
  });

  it('should allow modification of rsbuild config', async () => {
    const config = await withRsbuildConfig({
      configPath: testConfigPath,
      modifyRsbuildConfig: (rsbuildConfig) => ({
        ...rsbuildConfig,
        source: {
          ...rsbuildConfig.source,
          define: {
            ...rsbuildConfig.source?.define,
            'process.env.CUSTOM': '"custom-value"',
          },
        },
      }),
    })({});

    expect(config.source?.define).toEqual({
      'process.env.NODE_ENV': '"common"',
      'process.env.CUSTOM': '"custom-value"',
    });
  });

  it('should throw error when config file not found', async () => {
    await expect(() =>
      withRsbuildConfig({
        configPath: './non-existent.config.ts',
      })({}),
    ).rejects.toThrowError(/Cannot find config file/);
  });
});
