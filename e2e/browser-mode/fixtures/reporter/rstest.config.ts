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

  onTestRunStart() {
    lifecycleLogs.length = 0;
    lifecycleLogs.push('[browser reporter] onTestRunStart');
  }

  onTestRunEnd({
    results: _results,
    testResults: _testResults,
  }: {
    results: TestFileResult[];
    testResults: TestResult[];
  }) {
    lifecycleLogs.push('[browser reporter] onTestRunEnd');
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
