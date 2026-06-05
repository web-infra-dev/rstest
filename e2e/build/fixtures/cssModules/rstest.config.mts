import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: 'node',
  output: {
    cssModules: {
      localIdentName: '[name]__[local]',
    },
  },
});
