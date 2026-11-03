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
    'data:text/javascript;base64,dm9pZCAw?AAAA#v1',
    `data:text/javascript;base64,${Buffer.from(setupSource).toString('base64')}`,
    '../../../setup/fixtures/basic/sequence-first.ts',
    '../../../setup/fixtures/basic/sequence-second.ts',
  ],
  sequence: {
    setupFiles:
      process.env.SETUP_SEQUENCE === 'parallel'
        ? 'parallel'
        : process.env.SETUP_SEQUENCE === 'list'
          ? 'list'
          : undefined,
  },
  env: {
    SETUP_SEQUENCE: process.env.SETUP_SEQUENCE,
    SETUP_FAILURE: process.env.SETUP_FAILURE,
  },
  testTimeout: BROWSER_TEST_TIMEOUT,
});
