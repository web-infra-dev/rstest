import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['fixtures-cause/**/*.test.ts'],
  globalSetup: './fixtures-cause/globalSetup.ts',
});
