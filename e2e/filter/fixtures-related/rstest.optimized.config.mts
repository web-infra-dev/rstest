import { defineConfig } from '@rstest/core';

export default defineConfig({
  tools: {
    rspack: {
      optimization: { concatenateModules: true, usedExports: true },
    },
  },
});
