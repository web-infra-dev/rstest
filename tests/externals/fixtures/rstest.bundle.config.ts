import { defineConfig } from '@rstest/core';

export default defineConfig({
  tools: {
    rspack: (config) => {
      config.externals = [];
    },
  },
});
