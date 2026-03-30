import { defineConfig } from '@rstest/core';

export default defineConfig({
  exclude: ['test/sourcemapMapping.test.ts', 'allow-external/**'],
  coverage: {
    enabled: true,
    provider: 'v8',
    clean: false,
    reporters: [['text', { skipFull: true }]],
  },
  setupFiles: ['./rstest.setup.ts'],
});
