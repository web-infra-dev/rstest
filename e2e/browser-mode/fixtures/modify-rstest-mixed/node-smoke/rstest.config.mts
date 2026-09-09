import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: 'node-smoke',
  include: ['tests/**/*.test.ts'],
});
