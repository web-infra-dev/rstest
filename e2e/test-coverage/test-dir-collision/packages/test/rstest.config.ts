import { defineConfig } from '@rstest/core';

export default defineConfig({
  coverage: {
    include: ['src/**/*.ts'],
    reporters: ['text'],
  },
});
