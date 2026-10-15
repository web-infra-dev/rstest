import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: 'jsdom-30-native',
  isolate: false,
  testEnvironment: {
    name: 'jsdom',
    prebundle: false,
  },
});
