import type { TestFileResult, TestResult } from '../types';
import {
  color,
  getTaskNameWithPrefix,
  logger,
  prettyTestPath,
  prettyTime,
} from '../utils';

export const statusStr = {
  fail: '✗',
  pass: '✓',
  todo: '-',
  skip: '-',
};

export const statusColorfulStr = {
  fail: color.red(statusStr.fail) as string,
  pass: color.green(statusStr.pass) as string,
  todo: color.gray(statusStr.todo) as string,
  skip: color.gray(statusStr.skip) as string,
};

export const logCase = (
  result: TestResult,
  slowTestThreshold: number,
): void => {
  const isSlowCase = (result.duration || 0) > slowTestThreshold;

  const icon =
    isSlowCase && result.status === 'pass'
      ? color.yellow(statusStr[result.status])
      : statusColorfulStr[result.status];
  const nameStr = getTaskNameWithPrefix(result);
  const duration =
    typeof result.duration !== 'undefined'
      ? ` (${prettyTime(result.duration)})`
      : '';
  const retry = result.retryCount
    ? color.yellow(` (retry x${result.retryCount})`)
    : '';
  logger.log(`  ${icon} ${nameStr}${color.gray(duration)}${retry}`);

  if (result.errors) {
    for (const error of result.errors) {
      console.error(color.red(`    ${error.message}`));
    }
  }
};

export const logFileTitle = (
  test: TestFileResult,
  relativePath: string,
  slowTestThreshold: number,
  alwaysShowTime = false,
): void => {
  let title = ` ${color.bold(statusColorfulStr[test.status])} ${prettyTestPath(relativePath)}`;

  const formatDuration = (duration: number) => {
    return color[duration > slowTestThreshold ? 'yellow' : 'green'](
      `${prettyTime(duration)}`,
    );
  };

  title += ` ${color.gray(`(${test.results.length})`)}`;

  const isTooSlow = test.duration && test.duration > slowTestThreshold;

  if (alwaysShowTime || isTooSlow) {
    title += ` ${formatDuration(test.duration!)}`;
  }

  logger.log(title);
};
