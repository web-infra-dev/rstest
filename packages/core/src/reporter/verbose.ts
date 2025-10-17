import { relative } from 'pathe';
import type { TestFileResult } from '../types';
import { DefaultReporter } from './index';
import { logCase, logFileTitle } from './utils';

export class VerboseReporter extends DefaultReporter {
  override onTestFileResult(test: TestFileResult): void {
    this.statusRenderer?.onTestFileResult(test);

    const relativePath = relative(this.rootPath, test.testPath);
    const { slowTestThreshold } = this.config;

    logFileTitle(test, relativePath, slowTestThreshold, true);

    for (const result of test.results) {
      logCase(result, slowTestThreshold);
    }
  }
}
