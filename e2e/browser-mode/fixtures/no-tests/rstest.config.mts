import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['no-tests'],
    strictPort: true,
    // If the provider is launched for an empty run, this invalid executable
    // makes the regression observable. Empty runs should stop before launch.
    providerOptions: {
      launch: {
        executablePath: './should-not-launch-browser-for-empty-runs',
      },
    },
  },
  // Intentionally points to a non-existing directory to cover the
  // "No test files found" branch in browser mode.
  include: ['tests/**/*.test.ts'],
});
