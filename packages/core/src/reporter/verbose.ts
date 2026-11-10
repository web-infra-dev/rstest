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
    this.nonTTYProgressNotifier?.notifyOutput();

    const { hideSkippedTestFiles, hideSkippedTests, slowTestThreshold } =
      this.resolveFileOptions(test.project);

    if (hideSkippedTestFiles && test.status === 'skipped') {
      return;
    }

    const logResults = () => {
      logFileTitle(
        test,
        test.relativeTestPath,
        true,
        this.verboseOptions.showProjectName,
      );

      for (const result of test.results) {
        logCase(result, {
          slowTestThreshold,
          hideSkippedTests,
        });
      }
    };

    this.withSuspendedStatusRenderer(logResults);
  }
}
