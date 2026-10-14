import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: 'jsdom-30-prebundle',
  isolate: false,
  testEnvironment: {
    name: 'jsdom',
    prebundle: true,
  },
});
