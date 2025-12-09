import { defineConfig } from '@rstest/core';

export default defineConfig({
  setupFiles: ['../../scripts/rstest.setup.ts'],
  include: ['<rootDir>/tests/**/*.test.ts'],
  globals: true,
  source: {
    tsconfigPath: './tests/tsconfig.json',
    define: {
      RSTEST_VERSION: JSON.stringify('0.0.0'),
      'process.env.GITHUB_ACTIONS': JSON.stringify('false'),
    },
  },
});
