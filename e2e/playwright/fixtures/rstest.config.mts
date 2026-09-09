import { defineConfig } from '@rstest/core';
import { definePlaywrightConfig } from '@rstest/playwright/config';

export default defineConfig({
  extends: definePlaywrightConfig({
    contextOptions: {
      viewport: { width: 777, height: 555 },
    },
  }),
  include: ['./*.test.ts'],
  isolate: false,
  testEnvironment: 'node',
});
