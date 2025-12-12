import type {
  Reporter,
  TestCaseInfo,
  TestFileInfo,
  TestFileResult,
  TestResult,
  TestSuiteInfo,
} from '@rstest/core';
import { defineConfig } from '@rstest/core';

export const reporterResult: string[] = [];

class MyReporter implements Reporter {
  onTestFileStart(_file: TestFileInfo) {
    reporterResult.push('[custom reporter] onTestFileStart');
  }

  onTestFileReady(_file: TestFileInfo) {
    reporterResult.push('[custom reporter] onTestFileReady');
  }

  onTestSuiteStart(_test: TestSuiteInfo) {
    reporterResult.push('[custom reporter] onTestSuiteStart');
  }

  onTestSuiteResult(_result: TestResult) {
    reporterResult.push('[custom reporter] onTestSuiteResult');
  }

  onTestCaseStart(_test: TestCaseInfo) {
    reporterResult.push('[custom reporter] onTestCaseStart');
  }

  onTestCaseResult(_result: TestResult) {
    reporterResult.push('[custom reporter] onTestCaseResult');
  }

  onTestRunEnd({
    results: _results,
    testResults: _testResults,
  }: {
    results: TestFileResult[];
    testResults: TestResult[];
  }) {
    reporterResult.push('[custom reporter] onTestRunEnd');
    console.log(reporterResult);
  }
}

export default defineConfig({
  include: ['**/fixtures/**'],
  reporters: [new MyReporter()],
});
