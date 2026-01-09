import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  browser: {
    enabled: true,
  },
  include: ['tests/**/*.test.tsx'],
  plugins: [pluginReact()],
});
