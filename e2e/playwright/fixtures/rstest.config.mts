import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['./*.test.ts'],
  isolate: false,
  testEnvironment: 'node',
});
