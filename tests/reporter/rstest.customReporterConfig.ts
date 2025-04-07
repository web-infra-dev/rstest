import { defineConfig } from '@rstest/core';
import type { Reporter } from '@rstest/core/node';

export const reporterResult: string[] = [];

class MyReporter implements Reporter {
  onTestFileStart(file) {
    reporterResult.push('[custom reporter] onTestFileStart');
  }

  onTestCaseResult(result) {
    reporterResult.push('[custom reporter] onTestCaseResult');
  }

  onTestRunEnd({ results, testResults }) {
    reporterResult.push('[custom reporter] onTestRunEnd');
    console.log(reporterResult);
  }
}

export default defineConfig({
  include: ['**/fixtures/**'],
  reporters: [new MyReporter()],
});
