import { basename } from 'node:path';
import type { Reporter, TestFileResult } from '@rstest/core';
import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

class WatchCycleFilesReporter implements Reporter {
  private testFiles: string[] = [];

  onTestRunStart(): void {
    this.testFiles.length = 0;
  }

  onTestFileResult(result: TestFileResult): void {
    this.testFiles.push(`${result.project}:${basename(result.testPath)}`);
  }

  onTestRunEnd(): void {
    console.log(`[watch-cycle-files] ${this.testFiles.sort().join(',')}`);
  }
}

// The projects retain independent sources while sharing a root so they can
// include one physical test path. Watch-mode chunk-hash baselines are keyed per
// project; a change in project-b after a change in project-a must still be
// detected (regression: a shared flat baseline let one project's compile
// clobber the other's diff state).
export default defineConfig({
  reporters: ['default', new WatchCycleFilesReporter()],
  projects: [
    {
      name: 'project-a',
      include: ['./project-a/tests/**/*.test.ts', './shared/shared.*.ts'],
      testTimeout: BROWSER_TEST_TIMEOUT,
      browser: {
        enabled: true,
        provider: 'playwright',
        headless: true,
        port: BROWSER_PORTS['watch-multi-project'],
      },
    },
    {
      name: 'project-b',
      include: ['./project-b/tests/**/*.test.ts', './shared/shared.*.ts'],
      testTimeout: BROWSER_TEST_TIMEOUT,
      browser: {
        enabled: true,
        provider: 'playwright',
        headless: true,
        port: BROWSER_PORTS['watch-multi-project'],
      },
    },
  ],
});
