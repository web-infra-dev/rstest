import fs from 'node:fs';
import path from 'node:path';
import type { Reporter } from '@rstest/core';
import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

const REPORT_LOG_PATH = path.join(process.cwd(), 'watch-reporter.log');

const writeReportLog = (event: string) => {
  fs.appendFileSync(REPORT_LOG_PATH, `${event}\n`, 'utf-8');
};

class WatchLifecycleReporter implements Reporter {
  onTestRunStart() {
    writeReportLog('onTestRunStart');
  }

  onTestRunEnd() {
    writeReportLog('onTestRunEnd');
  }
}

export default defineConfig({
  reporters: [new WatchLifecycleReporter()],
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['reporter-watch'],
  },
  include: ['tests/**/*.test.ts'],
});
