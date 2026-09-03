import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['./*.test.ts'],
  isolate: false,
  testEnvironment: 'node',
  playwright: {
    contextOptions: {
      viewport: { width: 777, height: 555 },
    },
  },
});
