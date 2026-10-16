import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: ['project-a', 'project-b'].map((name) => ({
    name,
    testTimeout: 30_000,
    browser: {
      enabled: true,
      provider: 'playwright' as const,
      headless: false,
      expect: { toMatchScreenshot: { stabilityTimeout: 10_000 } },
    },
    include: ['tests/**/*.test.ts'],
  })),
});
