import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['packages/**/tests/**/*.test.ts'],
  // TODO: support glob patterns in projects
  projects: ['packages/core', 'examples/node', 'examples/react'],
  globals: true,
  setupFiles: ['./scripts/rstest.setup.ts'],
});
