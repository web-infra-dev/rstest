import { defineConfig } from '@rstest/core';

export default defineConfig({
  exclude: ['test/sourcemapMapping.test.ts'],
  coverage: {
    enabled: true,
    provider: 'istanbul',
    reportsDirectory: 'test-temp-coverage',
  },
  setupFiles: ['./rstest.setup.ts'],
});
