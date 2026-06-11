import { defineConfig } from '@rstest/core';

export default defineConfig({
  federation: true,
  globalSetup: ['./setup.ts'],
});
