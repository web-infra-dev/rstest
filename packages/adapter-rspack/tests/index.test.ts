import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@rstest/core';
import { withRspackConfig } from '../src';

describe('withRspackConfig', () => {
  const testConfigPath = join(__dirname, 'test-temp-rspack.config.ts');
  const testConfigContent = `
import { defineConfig } from '@rspack/cli';

export default defineConfig([
  {
    name: 'client',
    target: 'web',
    output: {
      module: true,
    },
  },
  {
    name: 'server',
    target: 'node',
    output: {
      module: false,
    },
  },
]);
  `;

  beforeEach(() => {
    writeFileSync(testConfigPath, testConfigContent);
  });

  afterEach(() => {
    if (existsSync(testConfigPath)) {
      unlinkSync(testConfigPath);
    }
  });

  it('should load and convert rspack config to rstest config', async () => {
    const config = await withRspackConfig({
      configPath: testConfigPath,
    })({});

    expect(config).toBeDefined();
    expect(config.output).toEqual({ module: true });
    expect(config.testEnvironment).toBe('happy-dom');
  });

  it('should allow modification of rspack config', async () => {
    const config = await withRspackConfig({
      configPath: testConfigPath,
      modifyRspackConfig: (rspackConfig) => ({
        ...rspackConfig,
        output: {
          ...rspackConfig.output,
          module: false,
        },
      }),
    })({});

    expect(config.output).toEqual({ module: false });
  });

  it('should select config by name', async () => {
    const config = await withRspackConfig({
      configPath: testConfigPath,
      configName: 'server',
    })({});

    expect(config.output).toEqual({ module: false });
    expect(config.testEnvironment).toBe('node');
  });

  it('should throw error when config name not found', async () => {
    await expect(() =>
      withRspackConfig({
        configPath: testConfigPath,
        configName: 'missing',
      })({}),
    ).rejects.toThrowError(
      /Configuration with the name "missing" was not found/,
    );
  });
});
