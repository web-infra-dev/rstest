import { defineConfig } from '@rstest/core';

export default defineConfig({
  root: '../fixtures',
  projects: ['packages/node'],
});
