import { relative } from 'pathe';
import type { TestFileResult } from '../types';
import { DefaultReporter } from './index';
import { logCase, logFileTitle } from './utils';

export class VerboseReporter extends DefaultReporter {
  override onTestFileResult(test: TestFileResult): void {
    this.statusRenderer?.onTestFileResult();

    if (this.config.hideSkippedTestFiles && test.status === 'skip') {
      return;
    }

    const relativePath = relative(this.rootPath, test.testPath);
    const { slowTestThreshold } = this.config;

    logFileTitle(test, relativePath, true);

    for (const result of test.results) {
      logCase(result, {
        slowTestThreshold,
        hideSkippedTests: this.config.hideSkippedTests,
      });
    }
  }
}
