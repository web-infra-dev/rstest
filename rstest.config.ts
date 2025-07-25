import { defineConfig } from '@rstest/core';

export default defineConfig({
  // TODO: support glob patterns in projects
  projects: ['packages/core', 'examples/node', 'examples/react'],
  globals: true,
  setupFiles: ['./scripts/rstest.setup.ts'],
});
