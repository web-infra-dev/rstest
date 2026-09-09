import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: 'jsdom-29',
  isolate: false,
  testEnvironment: {
    name: 'jsdom',
    prebundle: false,
  },
});
