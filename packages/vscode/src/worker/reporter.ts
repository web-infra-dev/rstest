import type { Reporter } from '@rstest/core';
import { logger } from './logger';

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
      const fileCount = Array.isArray(results)
        ? results.length
        : results
          ? Object.keys(results).length
          : 0;
      const testCount = Array.isArray(testResults) ? testResults.length : 0;
      logger.debug('Forwarding test results', {
        fileCount,
        testCount,
      });
      this.onTestRunEndCallback({
        testFileResults: results,
        testResults: testResults,
      });
    }
  };
}
