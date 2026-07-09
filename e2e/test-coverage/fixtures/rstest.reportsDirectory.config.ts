import { defineConfig } from '@rstest/core';

export default defineConfig({
  exclude: ['test/sourcemapMapping.test.ts', 'allow-external/**'],
  coverage: {
    enabled: true,
    provider: 'istanbul',
    reportsDirectory: 'test-temp-coverage',
  },
  setupFiles: ['./rstest.setup.ts'],
});
