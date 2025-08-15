import path from 'node:path';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: 'node',
  tools: {
    rspack: {
      resolve: {
        alias: {
          './a': path.join(__dirname, './src/b'),
        },
      },
    },
  },
});
