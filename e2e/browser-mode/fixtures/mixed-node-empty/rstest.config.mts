import type { Reporter } from '@rstest/core';
import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

/**
 * Counts the run-level reporter hooks. In a filtered-mixed run (node project
 * matched zero files, browser project has tests) the unified finalize must fire
 * `onTestRunStart`/`onTestRunEnd` exactly once. Before the #1363 fix the run took
 * the empty-node early return and emitted neither hook, so the logged line was
 * absent entirely.
 */
class RunLifecycleCounter implements Reporter {
  private starts = 0;
  private ends = 0;

  onTestRunStart(): void {
    this.starts += 1;
  }

  onTestRunEnd(): void {
    this.ends += 1;
    console.log(`[run lifecycle] starts=${this.starts} ends=${this.ends}`);
  }
}

export default defineConfig({
  reporters: [new RunLifecycleCounter()],
  coverage: {
    enabled: true,
    include: ['src/**/*.ts'],
  },
  projects: [
    {
      name: 'browser',
      browser: {
        enabled: true,
        provider: 'playwright',
        headless: true,
        port: BROWSER_PORTS['mixed-node-empty'],
      },
      include: ['tests/browser/**/*.test.ts'],
    },
    {
      name: 'node',
      include: ['tests/node/**/*.test.ts'],
    },
  ],
});
