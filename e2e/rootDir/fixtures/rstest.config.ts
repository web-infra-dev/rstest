import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['<rootDir>/**/*.test.ts'],
  exclude: ['<rootDir>/index1.test.ts'],
});
