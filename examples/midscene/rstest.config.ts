import { defineConfig } from '@rstest/core';
import { pluginMidscene } from '@rstest/midscene/plugin';

export default defineConfig({
  browser: {
    enabled: true,
  },
  include: ['tests/**/*.test.ts'],
  testTimeout: 60000,
  plugins: [pluginMidscene()],
});
