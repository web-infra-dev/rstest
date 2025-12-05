import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: [
    {
      name: 'node',
      root: 'packages/node',
      globals: true,
    },
    {
      name: 'client',
      root: 'packages/client',
      globals: true,
      include: ['test/index.test.ts'],
    },
  ],
});
