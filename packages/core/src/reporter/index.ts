import type {
  Duration,
  Reporter,
  TestResult,
  TestSummaryResult,
} from '../types';
import { color, prettyTime } from '../utils';
import { printSummaryLog } from './summary';

export class DefaultReporter implements Reporter {
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
  }

  onTestRunEnd(
    results: TestSummaryResult[],
    testResults: TestResult[],
    duration: Duration,
  ): void {
    printSummaryLog(results, testResults, duration);
  }
}
