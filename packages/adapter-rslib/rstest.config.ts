import { defineConfig } from '@rstest/core';

export default defineConfig({
  root: __dirname,
  name: 'rslib',
  tools: {
    rspack: {
      watchOptions: {
        ignored: /test-temp-.*/,
      },
    },
  },
});
