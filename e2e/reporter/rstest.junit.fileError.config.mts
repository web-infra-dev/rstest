import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['fixtures-junit/**/*.test.ts'],
});
