import color from 'picocolors';
import type { TestResult } from '../types';
import { prettyTime } from '../utils';

export class DefaultReporter {
  onTestEnd(result: TestResult): void {
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
}
