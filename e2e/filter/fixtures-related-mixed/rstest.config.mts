import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: [
    {
      name: 'node-project',
      root: 'node',
      include: ['**/*.test.ts'],
    },
    {
      name: 'browser-project',
      root: 'browser',
      include: ['**/*.test.ts'],
      browser: {
        enabled: true,
        provider: 'invalid' as unknown as 'playwright',
        headless: true,
      },
    },
  ],
});
