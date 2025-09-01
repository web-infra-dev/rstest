import type { Reporter } from '@rstest/core';

export class VscodeReporter implements Reporter {
  private onTestRunEndCallback?: (data: {
    results: any;
    testResults: any;
  }) => void;

  constructor({
    onTestRunEndCallback,
  }: {
    onTestRunEndCallback?: (data: { results: any; testResults: any }) => void;
  }) {
    this.onTestRunEndCallback = onTestRunEndCallback;
  }

  onTestRunEnd: Reporter['onTestRunEnd'] = ({ results, testResults }) => {
    if (this.onTestRunEndCallback) {
      this.onTestRunEndCallback({ results, testResults });
    }
  };
}
