import { defineConfig } from '@rsbuild/core';

export default defineConfig({
  html: {
    title: 'Rstest Playwright Example',
  },
  source: {
    entry: {
      index: './src/index.ts',
    },
  },
});
