import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from '@rstest/core';
import { loadConfig } from '../src/config';

describe('Config Extends Mechanism', () => {
  let testConfigPath: string;

  // Rsbuild's loadConfig cache-busts with `?t=${Date.now()}` on native import().
  // Millisecond resolution can collide between sequential tests reusing the same
  // file path, causing Node.js to return a stale cached module. A random suffix
  // per test guarantees a unique path and avoids the cache hit entirely.
  const createConfigPath = () =>
    join(__dirname, `test-temp-extends-${randomUUID()}.config.ts`);

  afterEach(() => {
    if (testConfigPath && existsSync(testConfigPath)) {
      unlinkSync(testConfigPath);
    }
  });

  it('should handle extends with direct config object', async () => {
    testConfigPath = createConfigPath();
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
    testConfigPath = createConfigPath();
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
    testConfigPath = createConfigPath();
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
    testConfigPath = createConfigPath();
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

  it('should handle extends as array', async () => {
    testConfigPath = createConfigPath();
    const testConfigContent = `
import { defineConfig } from '@rstest/core';

export default defineConfig({
  extends: [
    {
      testEnvironment: 'jsdom',
      setupFiles: ['./setup-a.ts'],
      source: {
        define: {
          BASE_URL: '"https://example.com"'
        }
      }
    },
    {
      globals: true,
      testEnvironment: 'node',
      setupFiles: ['./setup-b.ts'],
      source: {
        define: {
          API_URL: '"https://api.example.com"'
        }
      }
    }
  ],
  testTimeout: 10000,
  testEnvironment: 'happy-dom'
});
    `;

    writeFileSync(testConfigPath, testConfigContent);

    const { content: config } = await loadConfig({
      path: testConfigPath,
    });

    expect(config.globals).toBe(true);
    expect(config.testEnvironment).toBe('happy-dom');
    expect(config.testTimeout).toBe(10000);
    expect(config.setupFiles).toEqual(['./setup-a.ts', './setup-b.ts']);
    expect(config.source).toEqual({
      define: {
        BASE_URL: '"https://example.com"',
        API_URL: '"https://api.example.com"',
      },
    });
  });

  it('should pass the original local config to every extends function in arrays', async () => {
    testConfigPath = createConfigPath();
    const testConfigContent = `
import { defineConfig } from '@rstest/core';

export default defineConfig({
  testTimeout: 10000,
  retry: 2,
  extends: [
    (userConfig) => {
      if (!Object.isFrozen(userConfig)) {
        throw new Error('userConfig should be frozen');
      }

      if (userConfig.testEnvironment !== undefined) {
        throw new Error('userConfig should not include previous extends result');
      }

      if (userConfig.testTimeout !== 10000 || userConfig.retry !== 2) {
        throw new Error('userConfig should match local config');
      }

      return {
        testEnvironment: 'jsdom',
      };
    },
    (userConfig) => {
      if (!Object.isFrozen(userConfig)) {
        throw new Error('userConfig should be frozen');
      }

      if (userConfig.testEnvironment !== undefined) {
        throw new Error('userConfig should remain the original local config');
      }

      if (userConfig.testTimeout !== 10000 || userConfig.retry !== 2) {
        throw new Error('userConfig should match local config');
      }

      return {
        globals: true,
      };
    }
  ]
});
    `;

    writeFileSync(testConfigPath, testConfigContent);

    const { content: config } = await loadConfig({
      path: testConfigPath,
    });

    expect(config.testEnvironment).toBe('jsdom');
    expect(config.globals).toBe(true);
    expect(config.testTimeout).toBe(10000);
    expect(config.retry).toBe(2);
  });
});
