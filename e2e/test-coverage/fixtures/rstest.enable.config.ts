import { defineConfig } from '@rstest/core';

export default defineConfig({
  exclude: ['test/sourcemapMapping.test.ts'],
  coverage: {
    enabled: true,
    provider: 'istanbul',
    exclude: ['src/sourcemap.ts'],
  },
  setupFiles: ['./rstest.setup.ts'],
});
