import { relative } from 'pathe';
import { parse as stackTraceParse } from 'stacktrace-parser';
import type { TestFileResult, TestResult, UserConsoleLog } from '../types';
import {
  color,
  getTaskNameWithPrefix,
  logger,
  prettyTestPath,
  prettyTime,
} from '../utils';

const statusStr = {
  fail: '✗',
  pass: '✓',
  todo: '-',
  skip: '-',
};

const statusColor: Record<keyof typeof statusStr, (str: string) => string> = {
  fail: color.red,
  pass: color.green,
  todo: color.gray,
  skip: color.gray,
};

const statusColorfulStr: {
  fail: string;
  pass: string;
  todo: string;
  skip: string;
} = {
  fail: statusColor.fail(statusStr.fail),
  pass: statusColor.pass(statusStr.pass),
  todo: statusColor.todo(statusStr.todo),
  skip: statusColor.skip(statusStr.skip),
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
      logger.log(color.red(`    ${error.message}`));
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
  showProjectName = false,
): void => {
  let title = ` ${color.bold(statusColorfulStr[test.status])}`;

  if (showProjectName && test.project) {
    title += ` ${statusColor[test.status](`[${test.project}]`)}`;
  }

  title += ` ${prettyTestPath(relativePath)}`;

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

export const logUserConsoleLog = (
  rootPath: string,
  log: UserConsoleLog,
): void => {
  const titles = [];
  const testPath = relative(rootPath, log.testPath);

  if (log.trace) {
    const [frame] = stackTraceParse(log.trace);
    const filePath = relative(rootPath, frame!.file || '');

    if (filePath !== testPath) {
      titles.push(testPath);
    }
    titles.push(`${filePath}:${frame!.lineNumber}:${frame!.column}`);
  } else {
    titles.push(testPath);
  }

  const logOutput = log.type === 'stdout' ? logger.log : logger.stderr;

  logOutput('');
  logOutput(
    `${log.name}${color.gray(color.dim(` | ${titles.join(color.gray(color.dim(' | ')))}`))}`,
  );
  logOutput(log.content);
  logOutput('');
};
