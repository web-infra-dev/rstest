import path from 'node:path';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: 'node',
  tools: {
    rspack: {
      experiments: {
        runtimeMode: 'rspack',
      },
      resolve: {
        alias: {
          './a': path.join(__dirname, './src/b'),
        },
      },
    },
  },
});
