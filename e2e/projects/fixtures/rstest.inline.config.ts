import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: [
    {
      root: 'packages/node',
      globals: true,
    },
    {
      root: 'packages/client',
      globals: true,
      include: ['test/index.test.ts'],
    },
  ],
});
