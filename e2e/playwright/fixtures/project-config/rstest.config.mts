import { defineConfig } from '@rstest/core';
import { definePlaywrightConfig } from '@rstest/playwright/config';

export default defineConfig({
  projects: [
    {
      name: 'configured',
      include: ['./configured.test.ts'],
      extends: definePlaywrightConfig({
        contextOptions: {
          viewport: { width: 777, height: 555 },
        },
      }),
    },
    {
      name: 'default',
      include: ['./default.test.ts'],
    },
  ],
  isolate: false,
  testEnvironment: 'node',
});
