import { defineConfig } from '@rstest/core';

export default defineConfig({
  exclude: ['test/sourcemapMapping.test.ts', 'allow-external/**'],
  coverage: {
    enabled: true,
    provider: 'istanbul',
    reporters: [
      [
        './custom-coverage-reporter.mjs',
        { outputFile: 'custom-coverage-report.json' },
      ],
    ],
  },
  setupFiles: ['./rstest.setup.ts'],
});
