import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['entry-override'],
  },
  include: ['tests/**/*.test.ts'],
  // Intentionally keep './src/index.ts' in this fixture.
  // If browser mode does not override rsbuild entry, rsbuild may detect and
  // execute it as the default entry (and it will throw).
});
