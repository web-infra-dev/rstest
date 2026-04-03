import { defineConfig } from '@rstest/core';

export default defineConfig({
  exclude: ['test/sourcemapMapping.test.ts', 'allow-external/**'],
  coverage: {
    enabled: true,
    provider: 'v8',
    reportsDirectory: 'test-temp-coverage',
  },
  setupFiles: ['./rstest.setup.ts'],
});
