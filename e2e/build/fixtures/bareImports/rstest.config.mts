import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['*.test.js'],
  setupFiles: ['./setup.js'],
  performance: { buildCache: process.env.BUILD_CACHE === 'true' },
  tools: {
    rspack: {
      optimization: {
        sideEffects: true,
        usedExports: process.env.USED_EXPORTS === 'true',
        concatenateModules: process.env.CONCAT === 'true',
      },
    },
  },
});
