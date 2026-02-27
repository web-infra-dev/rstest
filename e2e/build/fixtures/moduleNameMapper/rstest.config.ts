import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: 'node',
  root: __dirname,
  resolve: {
    moduleNameMapper: {
      // Map module-a to module-b using exact match
      '^module-a$': '<rootDir>/src/moduleB.ts',
      // Map @utils/* to ./src/utils/* using capture groups
      '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    },
  },
});
