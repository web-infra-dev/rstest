import { defineConfig } from '@rstest/core';

export default defineConfig({
  exclude: ['test/sourcemapMapping.test.ts'],
  coverage: {
    enabled: true,
    provider: 'istanbul',
    clean: false,
    reporters: [['text', { skipFull: true }]],
  },
  setupFiles: ['./rstest.setup.ts'],
});
