import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@rstest/core';
import { withRslibConfig } from '../src';

describe('withRslibConfig', () => {
  const testConfigPath = join(__dirname, 'test-temp-rslib.config.ts');
  const testConfigContent = `
import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [{ format: 'esm' }],
  source: {
    define: {
      'process.env.NODE_ENV': '"test"'
    }
  },
  resolve: {
    alias: {
      '@': './src'
    }
  }
});
  `;

  beforeEach(() => {
    // Create a temporary rslib config file for testing
    writeFileSync(testConfigPath, testConfigContent);
  });

  afterEach(() => {
    // Clean up test config file
    if (existsSync(testConfigPath)) {
      unlinkSync(testConfigPath);
    }
  });

  it('should load and convert rslib config to rstest config', async () => {
    const config = await withRslibConfig({
      configPath: testConfigPath,
    });

    expect(config).toBeDefined();
    expect(config.source?.define).toEqual({
      'process.env.NODE_ENV': '"test"',
    });
    expect(config.resolve?.alias).toEqual({
      '@': './src',
    });
    expect(config.testEnvironment).toBe('node');
  });

  it('should allow modification of rslib config', async () => {
    const config = await withRslibConfig({
      configPath: testConfigPath,
      modifyLibConfig: (libConfig) => ({
        ...libConfig,
        source: {
          ...libConfig.source,
          define: {
            ...libConfig.source?.define,
            'process.env.CUSTOM': '"custom-value"',
          },
        },
      }),
    });

    expect(config.source?.define).toEqual({
      'process.env.NODE_ENV': '"test"',
      'process.env.CUSTOM': '"custom-value"',
    });
  });

  it('should throw error when config file not found', async () => {
    await expect(() =>
      withRslibConfig({
        configPath: './non-existent.config.ts',
      }),
    ).rejects.toThrowError(/Cannot find config file:.*non-existent.config.ts/);
  });
});
