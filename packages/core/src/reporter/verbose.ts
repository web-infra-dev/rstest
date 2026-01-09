import { relative } from 'pathe';
import type {
  NormalizedConfig,
  RstestTestState,
  TestFileResult,
  VerboseReporterOptions,
} from '../types';
import { DefaultReporter } from './index';
import { logCase, logFileTitle } from './utils';

export class VerboseReporter extends DefaultReporter {
  private verboseOptions: VerboseReporterOptions = {};

  constructor({
    rootPath,
    options,
    config,
    testState,
  }: {
    rootPath: string;
    config: NormalizedConfig;
    options: VerboseReporterOptions;
    testState: RstestTestState;
  }) {
    super({
      rootPath,
      options: {
        ...options,
        summary: true,
      },
      config,
      testState,
    });
    this.verboseOptions = options;
  }

  override onTestFileResult(test: TestFileResult): void {
    this.statusRenderer?.onTestFileResult();

    const relativePath = relative(this.rootPath, test.testPath);
    const { slowTestThreshold } = this.config;

    logFileTitle(test, relativePath, true, this.verboseOptions.showProjectName);

    for (const result of test.results) {
      logCase(result, {
        slowTestThreshold,
        hideSkippedTests: this.config.hideSkippedTests,
      });
    }
  }
}
