import { relative } from 'pathe';
import { parse as stackTraceParse } from 'stacktrace-parser';
import type {
  DefaultReporterOptions,
  Duration,
  GetSourcemap,
  Reporter,
  RstestConfig,
  SnapshotSummary,
  TestFileInfo,
  TestFileResult,
  TestResult,
  UserConsoleLog,
} from '../types';
import {
  TEST_DELIMITER,
  color,
  getTaskNameWithPrefix,
  logger,
  parsePosix,
  prettyTime,
} from '../utils';
import { printSummaryErrorLogs, printSummaryLog } from './summary';

export class DefaultReporter implements Reporter {
  private rootPath: string;
  private config: RstestConfig;
  private options: DefaultReporterOptions = {};

  constructor({
    rootPath,
    options,
    config,
  }: {
    rootPath: string;
    config: RstestConfig;
    options: DefaultReporterOptions;
  }) {
    this.rootPath = rootPath;
    this.config = config;
    this.options = options;
  }

  onTestFileStart(test: TestFileInfo): void {
    const { rootPath } = this;
    const relativePath = relative(rootPath, test.testPath);
    const { dir, base } = parsePosix(relativePath);

    console.log('');
    console.log(
      `${color.gray(`${TEST_DELIMITER} ${dir ? `${dir}/` : ''}`)}${base}`,
    );
    console.log('');
  }

  onTestCaseResult(result: TestResult): void {
    const statusColorfulStr = {
      fail: color.red('✗'),
      pass: color.green('✓'),
      todo: color.gray('-'),
      skip: color.gray('-'),
    };

    const duration =
      typeof result.duration !== 'undefined'
        ? ` (${prettyTime(result.duration)})`
        : '';

    const icon = statusColorfulStr[result.status];
    const nameStr = getTaskNameWithPrefix(result);

    console.log(`  ${icon} ${nameStr}${color.gray(duration)}`);

    if (result.errors) {
      for (const error of result.errors) {
        console.error(color.red(`    ${error.message}`));
      }
    }
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
      const path = relative(this.rootPath, frame!.file || '');

      if (path !== testPath) {
        titles.push(color.gray(testPath));
      } else {
        titles.push(
          color.gray(`${path}:${frame!.lineNumber}:${frame!.column}`),
        );
      }
    } else {
      titles.push(color.gray(testPath));
    }

    // TODO: output to stdout or stderr
    logger.log(titles.join(color.gray(' | ')));

    logger.log(log.content);
    logger.log('');
  }

  async onTestRunEnd({
    results,
    testResults,
    duration,
    getSourcemap,
    snapshotSummary,
  }: {
    results: TestFileResult[];
    testResults: TestResult[];
    duration: Duration;
    snapshotSummary: SnapshotSummary;
    getSourcemap: GetSourcemap;
  }): Promise<void> {
    if (this.options.summary === false) {
      return;
    }
    await printSummaryErrorLogs({
      testResults,
      results,
      rootPath: this.rootPath,
      getSourcemap,
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
