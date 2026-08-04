import type { RsbuildPlugin } from '@rsbuild/core';
import { defineConfig } from '@rstest/core';
import type { RstestExposeAPI } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

const preserveNodeOnlyFlagsPlugin = (): RsbuildPlugin => ({
  name: 'preserve-node-only-flags',
  setup(api) {
    api
      .useExposed<RstestExposeAPI>('rstest')
      ?.modifyRstestConfig(() => undefined);
  },
});

// Browser-only run that sets node-only options: they are ignored but must each
// produce one warning after modifyRstestConfig hooks have run.
export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['browser-coverage-config-warnings'],
  },
  include: ['tests/sum.test.ts'],
  plugins: [preserveNodeOnlyFlagsPlugin()],
  logHeapUsage: true,
  detectAsyncLeaks: true,
  pool: {
    type: 'threads',
  },
});
