import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

export default defineConfig({
  plugins: [pluginReact()],
  browser: {
    enabled: true,
    headless: true,
    port: BROWSER_PORTS.react,
  },
  include: ['tests/**/*.test.tsx'],
  testTimeout: 30000,
});
