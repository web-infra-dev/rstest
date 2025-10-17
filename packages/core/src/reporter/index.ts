import { relative } from 'pathe';
import { parse as stackTraceParse } from 'stacktrace-parser';
import { isCI } from 'std-env';
import type {
  DefaultReporterOptions,
  Duration,
  GetSourcemap,
  NormalizedConfig,
  Reporter,
  SnapshotSummary,
  TestFileInfo,
  TestFileResult,
  TestResult,
  UserConsoleLog,
} from '../types';
import { color, logger, prettyTestPath } from '../utils';
import { StatusRenderer } from './statusRenderer';
import { printSummaryErrorLogs, printSummaryLog } from './summary';
import { logCase, logFileTitle } from './utils';

export class DefaultReporter implements Reporter {
  protected rootPath: string;
  protected config: NormalizedConfig;
  private options: DefaultReporterOptions = {};
  protected statusRenderer: StatusRenderer | undefined;

  constructor({
    rootPath,
    options,
    config,
  }: {
    rootPath: string;
    config: NormalizedConfig;
    options: DefaultReporterOptions;
  }) {
    this.rootPath = rootPath;
    this.config = config;
    this.options = options;
    if (!isCI) {
      this.statusRenderer = new StatusRenderer(rootPath);
    }
  }

  onTestFileStart(test: TestFileInfo): void {
    this.statusRenderer?.addRunningModule(test.testPath);
  }

  onTestFileResult(test: TestFileResult): void {
    this.statusRenderer?.removeRunningModule(test.testPath);

    const relativePath = relative(this.rootPath, test.testPath);
    const { slowTestThreshold } = this.config;

    logFileTitle(test, relativePath, slowTestThreshold);

    const displayedCases = test.results.filter(
      (result) =>
        result.status === 'fail' ||
        (result.duration || 0) > slowTestThreshold ||
        (result.retryCount || 0) > 0,
    );

    for (const result of displayedCases) {
      logCase(result, slowTestThreshold);
    }
  }

  onTestCaseResult(_result: TestResult): void {
    // TODO
    // this.statusRenderer?.updateRunningModule({ result.testPath, status: result.status });
  }

  onUserConsoleLog(log: UserConsoleLog): void {
    const shouldLog = this.config.onConsoleLog?.(log.content) ?? true;

    if (!shouldLog) {
      return;
    }

    const titles = [log.name];

    const testPath = relative(this.rootPath, log.testPath);

    if (log.trace) {
      const [frame] = stackTraceParse(log.trace);
      const filePath = relative(this.rootPath, frame!.file || '');

      if (filePath !== testPath) {
        titles.push(prettyTestPath(testPath));
      }
      titles.push(
        prettyTestPath(filePath) +
          color.gray(`:${frame!.lineNumber}:${frame!.column}`),
      );
    } else {
      titles.push(prettyTestPath(testPath));
    }

    // TODO: output to stdout or stderr
    logger.log(titles.join(color.gray(' | ')));

    logger.log(log.content);
    logger.log('');
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
  }: {
    results: TestFileResult[];
    testResults: TestResult[];
    duration: Duration;
    snapshotSummary: SnapshotSummary;
    getSourcemap: GetSourcemap;
    filterRerunTestPaths?: string[];
  }): Promise<void> {
    this.statusRenderer?.clear();

    if (this.options.summary === false) {
      return;
    }

    await printSummaryErrorLogs({
      testResults,
      results,
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
