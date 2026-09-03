import { defineConfig } from '@rstest/core';

export default defineConfig({
  env: {
    NODE_OPTIONS: '--not-a-real-node-option',
  },
});
