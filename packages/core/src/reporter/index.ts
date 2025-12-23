import { relative } from 'pathe';
import { parse as stackTraceParse } from 'stacktrace-parser';
import type {
  DefaultReporterOptions,
  Duration,
  GetSourcemap,
  NormalizedConfig,
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
  private options: DefaultReporterOptions = {};
  protected statusRenderer: StatusRenderer | undefined;
  private testState: RstestTestState;

  constructor({
    rootPath,
    options,
    config,
    testState,
  }: {
    rootPath: string;
    config: NormalizedConfig;
    options: DefaultReporterOptions;
    testState: RstestTestState;
  }) {
    this.rootPath = rootPath;
    this.config = config;
    this.options = options;
    this.testState = testState;
    if (isTTY() || options.logger) {
      this.statusRenderer = new StatusRenderer(
        rootPath,
        testState,
        options.logger,
      );
    }
  }

  onTestFileStart(): void {
    this.statusRenderer?.onTestFileStart();
  }

  onTestFileResult(test: TestFileResult): void {
    this.statusRenderer?.onTestFileResult();

    const relativePath = relative(this.rootPath, test.testPath);
    const { slowTestThreshold } = this.config;

    logFileTitle(test, relativePath);
    // Always display all test cases when running a single test file
    const showAllCases = this.testState.getTestFiles()?.length === 1;

    for (const result of test.results) {
      const isDisplayed =
        showAllCases ||
        result.status === 'fail' ||
        (result.duration ?? 0) > slowTestThreshold ||
        (result.retryCount ?? 0) > 0;
      isDisplayed &&
        logCase(result, {
          slowTestThreshold,
          hideSkippedTests: this.config.hideSkippedTests,
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
