import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['src'],
  exclude: ['*/index.ts'],
});
