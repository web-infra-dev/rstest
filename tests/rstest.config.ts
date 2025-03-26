import { defineConfig } from '@rstest/core';

export default defineConfig({
  passWithNoTests: true,
  setupFiles: ['./rstest.setup.ts'],
});
