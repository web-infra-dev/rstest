import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../../ports';

export default defineConfig({
  name: 'project-full',
  include: ['tests/**/*.test.ts'],
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['browser-empty-project'],
  },
});
