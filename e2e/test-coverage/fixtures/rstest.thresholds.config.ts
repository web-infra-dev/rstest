import { defineConfig } from '@rstest/core';

export default defineConfig({
  exclude: ['test/sourcemapMapping.test.ts', 'allow-external/**'],
  reporters: [
    'json',
    'md',
    {
      onTestRunEnd({ status, summary }) {
        console.log(
          `RUN_END_STATUS:${status}:FAILED_TESTS:${summary.tests.failed}`,
        );
      },
    },
  ],
  coverage: {
    enabled: true,
    reporters: [],
    clean: false,
    thresholds: {
      statements: 100,
      lines: -1,
    },
  },
  setupFiles: ['./rstest.setup.ts'],
});
