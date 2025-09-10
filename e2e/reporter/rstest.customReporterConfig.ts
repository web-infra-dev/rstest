import type {
  Reporter,
  TestFileInfo,
  TestFileResult,
  TestResult,
} from '@rstest/core';
import { defineConfig } from '@rstest/core';

export const reporterResult: string[] = [];

class MyReporter implements Reporter {
  onTestFileStart(_file: TestFileInfo) {
    reporterResult.push('[custom reporter] onTestFileStart');
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
