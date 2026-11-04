import { defineConfig } from '@rstest/core';
import { withRstackLibConfig } from '../../scripts/rstestConfig';

export default defineConfig({
  extends: withRstackLibConfig(import.meta.dirname),
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
