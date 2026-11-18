import { defineConfig } from '@rstest/core';
import base from './rstest.config.mts';

export default defineConfig({
  ...base,
  include: ['full/**/*.test.ts'],
  browser: { ...base.browser, provider: 'playwright', viewport: undefined },
});
