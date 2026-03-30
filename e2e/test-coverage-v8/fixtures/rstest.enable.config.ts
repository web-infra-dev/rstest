import { defineConfig } from '@rstest/core';

export default defineConfig({
  exclude: ['test/sourcemapMapping.test.ts', 'allow-external/**'],
  coverage: {
    enabled: true,
    provider: 'v8',
    exclude: [
      'src/sourcemap.ts',
      '**/test/**',
      '**/*.test.ts',
      'rstest.setup.ts',
      '**/index.test.ts',
      'test/**',
    ],
  },
  setupFiles: ['./rstest.setup.ts'],
});
