import type { Reporter } from '@rstest/core';

export class VscodeReporter implements Reporter {
  private onTestRunEndCallback?: (data: {
    testFileResults: any;
    testResults: any;
  }) => void;

  constructor({
    onTestRunEndCallback,
  }: {
    onTestRunEndCallback?: (data: {
      testResults: any;
      testFileResults: any;
    }) => void;
  }) {
    this.onTestRunEndCallback = onTestRunEndCallback;
  }

  onTestRunEnd: Reporter['onTestRunEnd'] = ({ results, testResults }) => {
    if (this.onTestRunEndCallback) {
      this.onTestRunEndCallback({
        testFileResults: results,
        testResults: testResults,
      });
    }
  };
}
