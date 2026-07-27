import type { Reporter } from '@rstest/core';
import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

// A zero-test browser-only run that still drives the full reporter lifecycle.
// Before Phase 3 the browser host returned early WITHOUT `onTestRunStart` /
// `onTestRunEnd` (junit/json emitted nothing, Appendix A bug 12); now the empty
// run routes through core's `finalizeRunCycle`, so lifecycle hooks fire, the
// per-project root/include/exclude detail prints, and the json file is written.
class LifecycleProbeReporter implements Reporter {
  onTestRunStart() {
    process.stdout.write('\nPROBE_RUN_START\n');
  }

  onTestRunEnd() {
    process.stdout.write('\nPROBE_RUN_END\n');
  }
}

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['no-tests-reporters'],
  },
  // Intentionally points to a non-existing directory: no test files on the
  // browser side.
  include: ['tests/**/*.test.ts'],
  reporters: [
    'default',
    new LifecycleProbeReporter(),
    ['json', { outputPath: './.tmp/report.json' }],
  ],
});
