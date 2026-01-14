import { defineConfig } from '@rstest/core';
import { withRslibConfig } from '../adapter-rslib/src';

export default defineConfig({
  extends: withRslibConfig({
    cwd: __dirname,
  }),
  name: 'core',
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
