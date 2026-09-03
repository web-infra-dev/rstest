import { defineConfig } from '@rstest/core';
import type { PlaywrightOptions } from '@rstest/playwright';

export default defineConfig({
  include: ['./test/**/*.test.ts'],
  isolate: false,
  testEnvironment: 'node',
  playwright: {
    browserName: 'chromium',
    launchOptions: process.env.CI ? { channel: 'chrome' } : undefined,
  } satisfies PlaywrightOptions,
});
