import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS.config,
  },
  include: ['./index.test.ts'],
  globals: true,
  performance: {
    buildCache: {
      cacheDirectory: '.cache/browser-build-cache',
      cacheDigest: ['browser-fixture'],
      buildDependencies: ['./rstest.config.mts'],
    },
  },
});
