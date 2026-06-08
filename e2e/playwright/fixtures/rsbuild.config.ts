import { defineConfig } from '@rsbuild/core';

export default defineConfig({
  html: {
    title: 'Rstest Playwright E2E',
  },
  source: {
    entry: {
      index: './src/index.ts',
    },
  },
});
