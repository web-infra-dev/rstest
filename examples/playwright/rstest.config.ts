import { defineConfig } from '@rstest/core';
import { definePlaywrightConfig } from '@rstest/playwright/config';

export default defineConfig({
  extends: definePlaywrightConfig({
    browserName: 'chromium',
    launchOptions: process.env.CI ? { channel: 'chrome' } : undefined,
  }),
  include: ['./test/**/*.test.ts'],
  isolate: false,
  testEnvironment: 'node',
});
