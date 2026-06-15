import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../../ports';

export default defineConfig({
  name: 'project-a',
  plugins: [pluginReact()],
  include: ['tests/**/*.test.tsx'],
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['multi-project-config'],
  },
});
