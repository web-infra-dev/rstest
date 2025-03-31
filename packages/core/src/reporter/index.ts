import { posix } from 'node:path';
import type {
  Duration,
  GetSourcemap,
  Reporter,
  TestFileInfo,
  TestResult,
  TestSummaryResult,
} from '../types';
import { color, prettyTime } from '../utils';
import { printSummaryErrorLogs, printSummaryLog } from './summary';

export class DefaultReporter implements Reporter {
  private rootPath: string;

  constructor({ rootPath }: { rootPath: string }) {
    this.rootPath = rootPath;
  }

  onTestFileStart(test: TestFileInfo): void {
    const { rootPath } = this;
    const relativePath = posix.relative(rootPath, test.filePath);
    const { dir, base } = posix.parse(relativePath);

    console.log('');
    console.log(`${color.gray(`> ${dir ? `${dir}/` : ''}`)}${base}`);
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

    console.log(
      `  ${icon} ${result.prefix}${result.name}${color.gray(duration)}`,
    );

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
  }: {
    results: TestSummaryResult[];
    testResults: TestResult[];
    duration: Duration;
    getSourcemap: GetSourcemap;
  }): Promise<void> {
    await printSummaryErrorLogs({
      testResults,
      rootPath: this.rootPath,
      getSourcemap,
    });
    printSummaryLog(results, testResults, duration);
  }
}
