import { defineConfig } from '@rstest/core';

export default defineConfig({
  root: __dirname,
  tools: {
    rspack: (config) => {
      config.devtool = 'inline-source-map';
    },
  },
  dev: {
    writeToDisk: true,
  },
});
