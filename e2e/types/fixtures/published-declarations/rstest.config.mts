import { defineConfig } from '@rstest/core';

export default defineConfig({
  typecheck: {
    only: true,
    include: process.env.TYPE_TEST_JEST_MATCHERS
      ? ['jestMatchers.ts']
      : ['index.ts'],
    tsconfig: process.env.TYPE_TEST_JEST_MATCHERS
      ? 'tsconfig.jest-matchers.json'
      : 'tsconfig.json',
  },
});
