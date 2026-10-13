import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: ['project-a', 'project-b'].map((name) => ({
    name,
    browser: {
      enabled: true,
      provider: 'playwright' as const,
      headless: true,
    },
    include: ['tests/**/*.test.ts'],
  })),
});
