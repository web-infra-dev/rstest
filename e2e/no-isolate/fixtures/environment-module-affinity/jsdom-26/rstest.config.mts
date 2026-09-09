import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: 'jsdom-26',
  isolate: false,
  testEnvironment: {
    name: 'jsdom',
    prebundle: false,
  },
});
