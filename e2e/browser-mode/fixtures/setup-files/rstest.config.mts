import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

const setupFilePath = fileURLToPath(new URL('./setup.ts', import.meta.url));
const setupSource = `import ${JSON.stringify(setupFilePath)};`;

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
