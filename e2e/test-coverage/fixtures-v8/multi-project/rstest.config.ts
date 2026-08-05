import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: [
    {
      name: 'app',
      root: 'packages/app',
      include: ['test/**/*.test.ts'],
    },
  ],
  coverage: {
    enabled: true,
    provider: 'v8',
    include: ['src/**/*.ts'],
    reporters: ['text'],
  },
});
