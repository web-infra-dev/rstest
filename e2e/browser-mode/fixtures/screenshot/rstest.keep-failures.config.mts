import { mock } from 'node:test';
import { defineConfig } from '@rstest/core';

const captureTime = process.env.RSTEST_TEST_CAPTURE_TIME;
if (captureTime) {
  mock.timers.enable({ apis: ['Date'], now: Date.parse(captureTime) });
}

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    screenshotFailures: { clean: false },
  },
  include: ['tests/**/*.test.ts'],
});
