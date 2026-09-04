import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

const setupSource = readFileSync(
  new URL('./setup.js', import.meta.url),
  'utf8',
);

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['setup-files'],
  },
  include: ['tests/**/*.test.ts'],
  setupFiles: [
    `data:text/javascript;base64,${Buffer.from(setupSource).toString('base64')}`,
  ],
  testTimeout: BROWSER_TEST_TIMEOUT,
});
