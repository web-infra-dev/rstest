import { defineConfig } from '@rstest/core';

export default defineConfig({
  globalSetup: ['./workerFixtureOrder.globalSetup.ts'],
});
