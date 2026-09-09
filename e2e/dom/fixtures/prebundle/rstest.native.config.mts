import { defineConfig } from '@rstest/core';

export default defineConfig({
  testEnvironment: {
    name: 'jsdom',
    prebundle: false,
  },
});
