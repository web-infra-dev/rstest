import { withRslibConfig } from '@rstest/adapter-rslib';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  extends: withRslibConfig({
    cwd: __dirname,
    libIndex: false,
  }),
  setupFiles: ['../../scripts/rstest.setup.ts'],
  include: ['<rootDir>/tests/**/*.test.ts'],
  globals: true,
  source: {
    tsconfigPath: './tests/tsconfig.json',
    define: {
      'process.env.GITHUB_ACTIONS': JSON.stringify('false'),
    },
  },
});
