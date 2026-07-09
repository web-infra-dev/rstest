import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['tests/unit/**/*.test.ts'],
  exclude: ['**/tests/fixtures/**', '**/tests/suite/**'],
  setupFiles: ['../../scripts/rstest.setup.ts'],
  globals: true,
  name: 'vscode',
  output: {
    externals: {
      vscode: 'commonjs vscode',
    },
  },
});
