import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: 'jsdom-30',
  isolate: false,
  testEnvironment: {
    name: 'jsdom',
    prebundle: false,
  },
});
