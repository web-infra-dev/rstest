import { relative } from 'pathe';
import { parse as stackTraceParse } from 'stacktrace-parser';
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
import { color, isTTY, logger } from '../utils';
import { StatusRenderer } from './statusRenderer';
import { printSummaryErrorLogs, printSummaryLog } from './summary';
import { logCase, logFileTitle } from './utils';

export class DefaultReporter implements Reporter {
  protected rootPath: string;
  protected config: NormalizedConfig;
  protected projectConfigs: Map<string, NormalizedProjectConfig>;
  private options: DefaultReporterOptions = {};
  protected statusRenderer: StatusRenderer | undefined;
  private testState: RstestTestState;

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
    // Note: StatusRenderer is created lazily in onTestFileStart() to avoid
    // intercepting stdout/stderr too early. This ensures that errors occurring
    // before tests start (e.g., Playwright browser not installed) are visible
    // and not cleared by WindowRenderer's TTY control sequences.
  }

  /**
   * Lazily create StatusRenderer on first test file start.
   * This avoids intercepting stdout/stderr before tests actually begin,
   * ensuring early errors (like missing Playwright browsers) remain visible.
   */
  private ensureStatusRenderer(): void {
    if (this.statusRenderer) return;
    if (isTTY() || this.options.logger) {
      this.statusRenderer = new StatusRenderer(
        this.rootPath,
        this.testState,
        this.options.logger,
      );
    }
  }

  onTestFileStart(): void {
    this.ensureStatusRenderer();
    this.statusRenderer?.onTestFileStart();
  }

  onTestFileResult(test: TestFileResult): void {
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

    const titles = [];

    const testPath = relative(this.rootPath, log.testPath);

    if (log.trace) {
      const [frame] = stackTraceParse(log.trace);
      const filePath = relative(this.rootPath, frame!.file || '');

      if (filePath !== testPath) {
        titles.push(testPath);
      }
      titles.push(`${filePath}:${frame!.lineNumber}:${frame!.column}`);
    } else {
      titles.push(testPath);
    }
    const logOutput = log.type === 'stdout' ? logger.log : logger.stderr;

    logOutput('');
    logOutput(
      `${log.name}${color.gray(color.dim(` | ${titles.join(color.gray(color.dim(' | ')))}`))}`,
    );
    logOutput(log.content);
    logOutput('');
  }

  async onExit(): Promise<void> {
    this.statusRenderer?.clear();
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
