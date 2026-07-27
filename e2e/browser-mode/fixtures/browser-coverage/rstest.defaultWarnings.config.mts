import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

// A plain browser config that sets none of the node-only options: the baseline
// for "no `Ignoring ... in browser mode` warnings". It exists separately from
// `rstest.config.mts` only so configWarnings.test.ts does not share that file's
// dev-server port (and build cache) with coverage.test.ts, which runs in
// parallel.
export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['browser-coverage-config-warnings'],
  },
  include: ['tests/sum.test.ts'],
});
