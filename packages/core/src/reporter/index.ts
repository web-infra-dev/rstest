import { relative } from 'pathe';
import { TEST_DELIMITER } from '../constants';
import type {
  Duration,
  GetSourcemap,
  Reporter,
  SnapshotSummary,
  TestFileInfo,
  TestFileResult,
  TestResult,
} from '../types';
import { color, getTaskNames, parsePosix, prettyTime } from '../utils';
import { printSummaryErrorLogs, printSummaryLog } from './summary';

export class DefaultReporter implements Reporter {
  private rootPath: string;

  constructor({ rootPath }: { rootPath: string }) {
    this.rootPath = rootPath;
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
    const nameStr = getTaskNames(result).join(` ${TEST_DELIMITER} `);

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
