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
import { isTTY } from '../utils';
import { CIProgressNotifier } from './ciProgressNotifier';
import { StatusRenderer } from './statusRenderer';
import { printSummaryErrorLogs, printSummaryLog } from './summary';
import { logCase, logFileTitle, logUserConsoleLog } from './utils';

export class DefaultReporter implements Reporter {
  protected rootPath: string;
  protected config: NormalizedConfig;
  protected projectConfigs: Map<string, NormalizedProjectConfig>;
  private readonly options: DefaultReporterOptions = {};
  protected statusRenderer: StatusRenderer | undefined;
  protected ciProgressNotifier: CIProgressNotifier | undefined;
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
    if (isTTY() || options.logger) {
      this.statusRenderer = new StatusRenderer(
        rootPath,
        testState,
        options.logger,
      );
    } else {
      this.ciProgressNotifier = new CIProgressNotifier(rootPath, testState);
    }
  }

  onTestFileStart(): void {
    this.statusRenderer?.onTestFileStart();
    this.ciProgressNotifier?.start();
  }

  onTestFileResult(test: TestFileResult): void {
    this.statusRenderer?.onTestFileResult();
    this.ciProgressNotifier?.notifyOutput();

    const projectConfig = this.projectConfigs.get(test.project);
    const hideSkippedTestFiles =
      projectConfig?.hideSkippedTestFiles ?? this.config.hideSkippedTestFiles;

    if (hideSkippedTestFiles && test.status === 'skip') {
      return;
    }

    const relativePath = relative(this.rootPath, test.testPath);
    const slowTestThreshold =
      projectConfig?.slowTestThreshold ?? this.config.slowTestThreshold;

    logFileTitle(test, relativePath, false, this.options.showProjectName);
    // Always display all test cases when running a single test file
    const showAllCases = this.testState.getTestFiles()?.length === 1;

    const hideSkippedTests =
      projectConfig?.hideSkippedTests ?? this.config.hideSkippedTests;

    for (const result of test.results) {
      const isDisplayed =
        showAllCases ||
        result.status === 'fail' ||
        (result.duration ?? 0) > slowTestThreshold ||
        (result.retryCount ?? 0) > 0;
      isDisplayed &&
        logCase(result, {
          slowTestThreshold,
          hideSkippedTests,
        });
    }
  }

  onTestCaseResult(): void {
    this.statusRenderer?.onTestCaseResult();
  }

  onUserConsoleLog(log: UserConsoleLog): void {
    const shouldLog = this.config.onConsoleLog?.(log.content) ?? true;

    if (!shouldLog) {
      return;
    }

    this.ciProgressNotifier?.notifyOutput();

    logUserConsoleLog(this.rootPath, log);
  }

  onExit(): void {
    this.statusRenderer?.clear();
    this.ciProgressNotifier?.stop();
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
    this.ciProgressNotifier?.stop();

    if (this.options.summary === false) {
      return;
    }

    await printSummaryErrorLogs({
      testResults,
      results,
      unhandledErrors,
      rootPath: this.rootPath,
      getSourcemap,
      filterRerunTestPaths,
    });

    printSummaryLog({
      results,
      testResults,
      duration,
      rootPath: this.rootPath,
      snapshotSummary,
    });
  }
}
