import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from '@rstest/core';
import { loadConfig } from '../src/config';

describe('Config Extends Mechanism', () => {
  const testConfigPath = join(__dirname, 'test-temp-extends.config.ts');

  beforeEach(() => {
    // Clean up any existing test config
    if (existsSync(testConfigPath)) {
      unlinkSync(testConfigPath);
    }
  });

  it('should handle extends with direct config object', async () => {
    const testConfigContent = `
import { defineConfig } from '@rstest/core';

export default defineConfig({
  extends: {
    testEnvironment: 'jsdom',
    globals: true,
    include: ['**/*.test.ts']
  },
  testTimeout: 10000,
  retry: 2
});
    `;

    writeFileSync(testConfigPath, testConfigContent);

    const { content: config } = await loadConfig({
      path: testConfigPath,
    });

    expect(config.testEnvironment).toBe('jsdom');
    expect(config.globals).toBe(true);
    expect(config.include).toEqual(['**/*.test.ts']);
    expect(config.testTimeout).toBe(10000);
    expect(config.retry).toBe(2);
  });

  it('should handle extends with extend config function', async () => {
    const testConfigContent = `
import { defineConfig } from '@rstest/core';

export default defineConfig({
  extends: (userConfig) => {
  // check something from userConfig
  if (!userConfig.retry) {
    return {};
  }
   return Promise.resolve({
    testEnvironment: 'jsdom',
    globals: true,
    include: ['**/*.test.ts']
  })
  },
  testTimeout: 10000,
  retry: 2
});
    `;

    writeFileSync(testConfigPath, testConfigContent);

    const { content: config } = await loadConfig({
      path: testConfigPath,
    });

    expect(config.testEnvironment).toBe('jsdom');
    expect(config.globals).toBe(true);
    expect(config.include).toEqual(['**/*.test.ts']);
    expect(config.testTimeout).toBe(10000);
    expect(config.retry).toBe(2);
  });

  it('should merge extends config with local config', async () => {
    const testConfigContent = `
import { defineConfig } from '@rstest/core';

export default defineConfig({
  extends: {
    testEnvironment: 'jsdom',
    globals: true,
    testTimeout: 5000
  },
  testTimeout: 10000, // This should override extends
  retry: 2 // This should be added
});
    `;

    writeFileSync(testConfigPath, testConfigContent);

    const { content: config } = await loadConfig({
      path: testConfigPath,
    });

    expect(config.testEnvironment).toBe('jsdom');
    expect(config.globals).toBe(true);
    expect(config.testTimeout).toBe(10000); // Local config overrides
    expect(config.retry).toBe(2);
  });

  it('should handle extends without projects field', async () => {
    const testConfigContent = `
import { defineConfig } from '@rstest/core';

export default defineConfig({
  extends: {
    testEnvironment: 'jsdom',
    projects: ['some-project'] // This should be filtered out
  },
  retry: 2
});
    `;

    writeFileSync(testConfigPath, testConfigContent);

    const { content: config } = await loadConfig({
      path: testConfigPath,
    });

    expect(config.testEnvironment).toBe('jsdom');
    expect(config.retry).toBe(2);
    expect(config.projects).toBeUndefined(); // projects should be filtered from extends
  });
});
