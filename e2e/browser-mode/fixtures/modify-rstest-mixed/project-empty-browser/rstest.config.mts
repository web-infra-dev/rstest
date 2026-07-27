import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../../ports';

export default defineConfig({
  name: 'project-empty-browser',
  include: ['missing/**/*.test.ts'],
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['multi-project-config'],
    strictPort: true,
  },
});
