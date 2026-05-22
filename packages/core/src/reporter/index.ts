import { relative } from 'pathe';
import type {
  DefaultReporterOptions,
  Duration,
  GetSourcemap,
  NormalizedConfig,
  NormalizedProjectConfig,
  Reporter,
  RstestTestState,
  SnapshotSummary,
  TestFileResult,
  TestResult,
  UserConsoleLog,
} from '../types';
import { flushOutputStreams, isTTY } from '../utils';
import { NonTTYProgressNotifier } from './nonTtyProgressNotifier';
import { StatusRenderer } from './statusRenderer';
import { printSummaryErrorLogs, printSummaryLog } from './summary';
import { logCase, logFileTitle, logUserConsoleLog } from './utils';

export class DefaultReporter implements Reporter {
  readonly flushOutputStreams: boolean;

  protected rootPath: string;
  protected config: NormalizedConfig;
  protected projectConfigs: Map<string, NormalizedProjectConfig>;
  private readonly options: DefaultReporterOptions = {};
  protected statusRenderer: StatusRenderer | undefined;
  protected nonTTYProgressNotifier: NonTTYProgressNotifier | undefined;
  private readonly testState: RstestTestState;

  constructor({
    rootPath,
    options,
    config,
    testState,
    projectConfigs,
  }: {
    rootPath: string;
    config: NormalizedConfig;
    options: DefaultReporterOptions;
    testState: RstestTestState;
    projectConfigs?: Map<string, NormalizedProjectConfig>;
  }) {
    this.rootPath = rootPath;
    this.config = config;
    this.projectConfigs = projectConfigs ?? new Map();
    this.options = options;
    this.testState = testState;
    this.flushOutputStreams = !options.logger;
    if (isTTY() || options.logger) {
      this.statusRenderer = new StatusRenderer(
        rootPath,
        testState,
        options.logger,
      );
    } else {
      this.nonTTYProgressNotifier = new NonTTYProgressNotifier(
        rootPath,
        testState,
      );
    }
  }

  onTestFileStart(): void {
    this.statusRenderer?.onTestFileStart();
    this.nonTTYProgressNotifier?.start();
  }

  protected withSuspendedStatusRenderer(fn: () => void): void {
    if (!this.statusRenderer) {
      fn();
      return;
    }

    this.statusRenderer.suspendWindowOutput();
    try {
      fn();
    } finally {
      this.statusRenderer.resumeWindowOutput();
    }
  }

  onUserConsoleLog(log: UserConsoleLog): void {
    this.nonTTYProgressNotifier?.notifyOutput();
    this.withSuspendedStatusRenderer(() => {
      logUserConsoleLog(this.rootPath, log);
    });
  }

  onTestCaseResult(_result: TestResult): void {
    this.statusRenderer?.onTestCaseResult();
  }

  onTestFileResult(test: TestFileResult): void {
    this.statusRenderer?.onTestFileResult();
    this.nonTTYProgressNotifier?.notifyOutput();

    const projectConfig = this.projectConfigs.get(test.project);
    const hideSkippedTestFiles =
      projectConfig?.hideSkippedTestFiles ?? this.config.hideSkippedTestFiles;

    if (hideSkippedTestFiles && test.status === 'skip') {
      return;
    }

    const relativePath = relative(this.rootPath, test.testPath);
    const slowTestThreshold =
      projectConfig?.slowTestThreshold ?? this.config.slowTestThreshold;

    const logResults = () => {
      logFileTitle(test, relativePath, false, this.options.showProjectName);
      const showAllCases = this.testState.getTestFiles()?.length === 1;

      const hideSkippedTests =
        projectConfig?.hideSkippedTests ?? this.config.hideSkippedTests;

      for (const result of test.results) {
        const isDisplayed =
          showAllCases ||
          result.status === 'fail' ||
          (result.duration ?? 0) > slowTestThreshold ||
          (result.retryCount ?? 0) > 0;
        if (isDisplayed) {
          logCase(result, {
            slowTestThreshold,
            hideSkippedTests,
          });
        }
      }
    };

    this.withSuspendedStatusRenderer(logResults);
  }

  onExit(): void {
    this.statusRenderer?.clear();
    this.nonTTYProgressNotifier?.stop();
  }

  async onTestRunEnd({
    results,
    testResults,
    duration,
    getSourcemap,
    snapshotSummary,
    filterRerunTestPaths,
    unhandledErrors,
  }: {
    results: TestFileResult[];
    testResults: TestResult[];
    duration: Duration;
    snapshotSummary: SnapshotSummary;
    getSourcemap: GetSourcemap;
    unhandledErrors?: Error[];
    filterRerunTestPaths?: string[];
  }): Promise<void> {
    this.statusRenderer?.clear();
    this.nonTTYProgressNotifier?.stop();

    if (this.options.summary === false) {
      return;
    }

    const hasErrorLogs = await printSummaryErrorLogs({
      testResults,
      results,
      unhandledErrors,
      rootPath: this.rootPath,
      getSourcemap,
      filterRerunTestPaths,
    });

    if (hasErrorLogs) {
      await flushOutputStreams();
    }

    printSummaryLog({
      results,
      testResults,
      duration,
      rootPath: this.rootPath,
      snapshotSummary,
    });
  }
}
