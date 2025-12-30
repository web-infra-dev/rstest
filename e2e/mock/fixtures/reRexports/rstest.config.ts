import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  testEnvironment: 'jsdom',
  plugins: [pluginReact()],
  tools: {
    rspack: {
      optimization: {
        providedExports: false,
      },
    },
  },
});
