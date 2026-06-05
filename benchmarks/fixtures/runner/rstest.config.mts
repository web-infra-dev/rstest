import { defineConfig } from '@rstest/core';

export default defineConfig({
  root: __dirname,
  include: ['tests/**/*.test.ts'],
});
