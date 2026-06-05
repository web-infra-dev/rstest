import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: [
    {
      name: 'node-slow',
      root: 'packages/node',
      include: ['test/slow.test.ts'],
      globals: true,
      // Low threshold - 50ms test should be marked slow
      slowTestThreshold: 10,
    },
    {
      name: 'client-fast',
      root: 'packages/client',
      include: ['test/slow.test.ts'],
      globals: true,
      // High threshold - 50ms test should NOT be marked slow
      slowTestThreshold: 1000,
    },
  ],
});
