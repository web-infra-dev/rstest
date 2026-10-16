import { defineConfig } from '@rstest/core';

export default defineConfig({
  testTimeout: 30_000,
  projects: ['project-a', 'project-b'].map((name) => ({
    name,
    browser: {
      enabled: true,
      provider: 'playwright' as const,
      headless: false,
      expect: { toMatchScreenshot: { stabilityTimeout: 10_000 } },
    },
    include: ['tests/**/*.test.ts'],
  })),
});
