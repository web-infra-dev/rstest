import path from 'node:path';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: 'node',
  resolve: {
    alias: {
      './a': path.join(__dirname, './src/b'),
    },
  },
});
