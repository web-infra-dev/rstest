import { defineConfig } from '@rstest/core';
import { withRstackLibConfig } from '../../scripts/rstestConfig';

export default defineConfig({
  extends: withRstackLibConfig(import.meta.dirname),
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
  tools: {
    rspack: {
      watchOptions: {
        ignored: /test-temp-.*/,
      },
    },
  },
});
