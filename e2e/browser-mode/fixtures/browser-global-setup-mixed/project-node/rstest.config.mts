import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: 'project-node',
  include: ['tests/**/*.test.ts'],
  globalSetup: ['./globalSetup.ts'],
});
