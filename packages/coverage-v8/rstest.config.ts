import { defineConfig } from '@rstest/core';
import { withRslibConfig } from '../adapter-rslib/src';

export default defineConfig({
  extends: withRslibConfig({
    cwd: __dirname,
  }),
  name: 'coverage-v8',
  setupFiles: ['../../scripts/rstest.setup.ts'],
  include: ['<rootDir>/tests/**/*.test.ts'],
  globals: true,
  source: {
    tsconfigPath: './tests/tsconfig.json',
  },
  tools: {
    rspack: {
      watchOptions: {
        ignored: /test-temp-.*/,
      },
    },
  },
});
