import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: 'project-a',
  plugins: [pluginReact()],
  include: ['tests/**/*.test.tsx'],
  browser: {
    enabled: true,
    provider: 'playwright',
  },
});
