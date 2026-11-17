import { defineConfig } from '@rstest/core';
import base from './rstest.config.mts';

export default defineConfig({
  ...base,
  include: ['failures/**/*.test.ts'],
  browser: {
    ...base.browser,
    provider: 'playwright',
    screenshotFailures: true,
  },
});
