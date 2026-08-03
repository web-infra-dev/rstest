import type {
  Reporter,
  TestCaseInfo,
  TestFileInfo,
  TestFileResult,
  TestResult,
  TestSuiteInfo,
} from '@rstest/core';
import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

const lifecycleLogs: string[] = [];
const reporterDelay = Number(process.env.RSTEST_REPORTER_DELAY ?? 100);

class BrowserLifecycleReporter implements Reporter {
  onTestFileReady(_file: TestFileInfo) {
    lifecycleLogs.push('[browser reporter] onTestFileReady');
  }

  onTestSuiteStart(_suite: TestSuiteInfo) {
    lifecycleLogs.push('[browser reporter] onTestSuiteStart');
  }

  onTestSuiteResult(_result: TestResult) {
    lifecycleLogs.push('[browser reporter] onTestSuiteResult');
  }

  onTestCaseStart(_test: TestCaseInfo) {
    lifecycleLogs.push('[browser reporter] onTestCaseStart');
  }

  async onTestFileResult(_result: TestFileResult) {
    await new Promise((resolve) => setTimeout(resolve, reporterDelay));
    lifecycleLogs.push('[browser reporter] onTestFileResult');
  }

  onTestRunStart() {
    lifecycleLogs.length = 0;
    lifecycleLogs.push('[browser reporter] onTestRunStart');
  }

  onTestRunEnd({
    results: _results,
    testResults: _testResults,
    unhandledErrors = [],
  }: {
    results: TestFileResult[];
    testResults: TestResult[];
    unhandledErrors?: Error[];
  }) {
    lifecycleLogs.push('[browser reporter] onTestRunEnd');
    lifecycleLogs.push(
      ...unhandledErrors.map(
        (error) => `[browser reporter] unhandledError: ${error.message}`,
      ),
    );
    console.log(lifecycleLogs.join('\n'));
  }
}

export default defineConfig({
  reporters: [new BrowserLifecycleReporter()],
  projects: [
    {
      name: 'browser',
      browser: {
        enabled: true,
        provider: 'playwright',
        headless: true,
        port: BROWSER_PORTS.reporter,
      },
      include: ['tests/browser/**/*.test.ts'],
    },
    {
      name: 'node',
      include: ['tests/node/**/*.test.ts'],
    },
  ],
});
