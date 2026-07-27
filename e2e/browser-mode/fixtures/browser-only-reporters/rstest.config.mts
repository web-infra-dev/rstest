import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

// A browser-only non-watch run with file-writing reporters. Before Phase 3 the
// browser host self-finalized without ever calling `flushOutputStreams`; now the
// run routes through core's `finalizeRunCycle`, which flushes output streams
// after every reporter, so the junit/json files are written completely.
export default defineConfig({
  testTimeout: BROWSER_TEST_TIMEOUT,
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['browser-only-reporters'],
  },
  include: ['tests/**/*.test.ts'],
  reporters: [
    'default',
    ['json', { outputPath: './.tmp/report.json' }],
    ['junit', { outputPath: './.tmp/report.xml' }],
  ],
});
