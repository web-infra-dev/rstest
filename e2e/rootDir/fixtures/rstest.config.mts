import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['<rootDir>/**/*.test.ts'],
  exclude: ['<rootDir>/tests/index1.test.ts'],
});
