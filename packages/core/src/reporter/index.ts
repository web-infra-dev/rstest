import { relative } from 'pathe';
import type {
  DefaultReporterOptions,
  Duration,
  GetSourcemap,
  Reporter,
  SnapshotSummary,
  TestFileInfo,
  TestFileResult,
  TestResult,
} from '../types';
import {
  TEST_DELIMITER,
  color,
  getTaskNameWithPrefix,
  parsePosix,
  prettyTime,
} from '../utils';
import { printSummaryErrorLogs, printSummaryLog } from './summary';

export class DefaultReporter implements Reporter {
  private rootPath: string;
  private options: DefaultReporterOptions = {};

  constructor({
    rootPath,
    options,
  }: { rootPath: string; options: DefaultReporterOptions }) {
    this.rootPath = rootPath;
    this.options = options;
  }

  onTestFileStart(test: TestFileInfo): void {
    const { rootPath } = this;
    const relativePath = relative(rootPath, test.filePath);
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
