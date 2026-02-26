import { relative } from 'pathe';
import type {
  NormalizedConfig,
  NormalizedProjectConfig,
  RstestTestState,
  TestFileResult,
  VerboseReporterOptions,
} from '../types';
import { DefaultReporter } from './index';
import { logCase, logFileTitle } from './utils';

export class VerboseReporter extends DefaultReporter {
  private readonly verboseOptions: VerboseReporterOptions = {};

  constructor({
    rootPath,
    options,
    config,
    testState,
    projectConfigs,
  }: {
    rootPath: string;
    config: NormalizedConfig;
    options: VerboseReporterOptions;
    testState: RstestTestState;
    projectConfigs?: Map<string, NormalizedProjectConfig>;
  }) {
    super({
      rootPath,
      options: {
        ...options,
        summary: true,
      },
      config,
      testState,
      projectConfigs,
    });
    this.verboseOptions = options;
  }

  override onTestFileResult(test: TestFileResult): void {
    this.statusRenderer?.onTestFileResult();

    const projectConfig = this.projectConfigs.get(test.project);
    const hideSkippedTestFiles =
      projectConfig?.hideSkippedTestFiles ?? this.config.hideSkippedTestFiles;

    if (hideSkippedTestFiles && test.status === 'skip') {
      return;
    }

    const relativePath = relative(this.rootPath, test.testPath);
    const slowTestThreshold =
      projectConfig?.slowTestThreshold ?? this.config.slowTestThreshold;
    const hideSkippedTests =
      projectConfig?.hideSkippedTests ?? this.config.hideSkippedTests;

    logFileTitle(test, relativePath, true, this.verboseOptions.showProjectName);

    for (const result of test.results) {
      logCase(result, {
        slowTestThreshold,
        hideSkippedTests,
      });
    }
  }
}
