import type { Reporter } from '@rstest/core';
import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

// A mixed run where ONLY the browser side fails: the node project passes fully.
// Pins the unified finalize — one `onTestRunEnd`, a merged (summed) duration,
// exit code 1 owned by core, and the browser failure detail in the summary
// block even though no node test failed to seed the filter (Appendix A bug 2).
class FinalizeProbeReporter implements Reporter {
  #count = 0;

  onTestRunEnd(summary: {
    duration: { totalTime: number; buildTime: number; testTime: number };
  }) {
    this.#count += 1;
    // Bypass console interception so the markers always reach stdout.
    process.stdout.write(`\nPROBE_ONEND_COUNT=${this.#count}\n`);
    process.stdout.write(
      `PROBE_ONEND_DURATION=${JSON.stringify(summary.duration)}\n`,
    );
  }
}

export default defineConfig({
  // Keep the default reporter (it writes the failing-test summary block to
  // stderr) and add the probe alongside it.
  reporters: ['default', new FinalizeProbeReporter()],
  projects: [
    {
      name: 'node',
      include: ['node-tests/**/*.test.ts'],
    },
    {
      name: 'browser',
      include: ['browser-tests/**/*.test.ts'],
      testTimeout: BROWSER_TEST_TIMEOUT,
      browser: {
        enabled: true,
        provider: 'playwright',
        headless: true,
        port: BROWSER_PORTS['mixed-browser-fail'],
      },
    },
  ],
});
