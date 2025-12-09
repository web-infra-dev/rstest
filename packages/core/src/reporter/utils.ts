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

export const statusColorfulStr: {
  fail: string;
  pass: string;
  todo: string;
  skip: string;
} = {
  fail: color.red(statusStr.fail),
  pass: color.green(statusStr.pass),
  todo: color.gray(statusStr.todo),
  skip: color.gray(statusStr.skip),
};

export const logCase = (
  result: TestResult,
  options: {
    slowTestThreshold: number;
    hideSkippedTests: boolean;
  },
): void => {
  const isSlowCase = (result.duration || 0) > options.slowTestThreshold;

  if (options.hideSkippedTests && result.status === 'skip') {
    return;
  }

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
  const heap = result.heap
    ? ` ${color.magenta(formatHeapUsed(result.heap))}`
    : '';

  logger.log(`  ${icon} ${nameStr}${color.gray(duration)}${retry}${heap}`);

  if (result.errors) {
    for (const error of result.errors) {
      console.error(color.red(`    ${error.message}`));
    }
  }
};

const formatHeapUsed = (heap: number) => {
  return `${Math.floor(heap / 1024 / 1024)} MB heap used`;
};

export const logFileTitle = (
  test: TestFileResult,
  relativePath: string,
  alwaysShowTime = false,
): void => {
  let title = ` ${color.bold(statusColorfulStr[test.status])} ${prettyTestPath(relativePath)}`;

  const formatDuration = (duration: number) => {
    return color.green(prettyTime(duration));
  };

  title += ` ${color.gray(`(${test.results.length})`)}`;

  if (alwaysShowTime) {
    title += ` ${formatDuration(test.duration!)}`;
  }

  if (test.heap) {
    title += ` ${color.magenta(formatHeapUsed(test.heap))}`;
  }

  logger.log(title);
};
