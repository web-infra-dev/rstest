import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['packages/@rstest/app/test/**/*.test.ts'],
  coverage: {
    enabled: true,
    provider: 'v8',
    include: ['packages/@rstest/app/src/**/*.ts'],
    reporters: ['text'],
  },
});
