import { parse, relative } from 'node:path';
import type {
  Duration,
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
    const relativePath = relative(rootPath, test.filePath);
    const { dir, base } = parse(relativePath);

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

  onTestRunEnd(
    results: TestSummaryResult[],
    testResults: TestResult[],
    duration: Duration,
  ): void {
    printSummaryErrorLogs({ testResults, rootPath: this.rootPath });
    printSummaryLog(results, testResults, duration);
  }
}
