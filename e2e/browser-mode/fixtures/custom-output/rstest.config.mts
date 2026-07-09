import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS.config,
  },
  include: ['./*.test.ts'],
  globals: true,
  dev: {
    writeToDisk: true,
  },
  output: {
    distPath: {
      root: 'custom/.rstest-temp',
    },
  },
});
