import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../../ports';

export default defineConfig({
  name: 'project-plain-browser',
  include: ['tests/**/*.test.ts'],
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['multi-project-config'],
  },
});
