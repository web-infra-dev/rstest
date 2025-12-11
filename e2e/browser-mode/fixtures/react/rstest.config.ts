import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  plugins: [pluginReact()],
  browser: {
    enabled: true,
    // headless: true,
    port: 5184,
  },
  include: ['tests/**/*.test.tsx'],
  testTimeout: 30000,
});
