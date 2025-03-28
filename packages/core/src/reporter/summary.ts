import { relative } from 'node:path';
import type { Duration, TestResult, TestSummaryResult } from '../types';
import { color, logger, prettyTime } from '../utils';

export const getSummaryStatusString = (
  tasks: TestResult[],
  name = 'tests',
  showTotal = true,
): string => {
  if (tasks.length === 0) {
    return color.dim(`no ${name}`);
  }

  const passed = tasks.filter((result) => result.status === 'pass');
  const failed = tasks.filter((result) => result.status === 'fail');
  const skipped = tasks.filter((result) => result.status === 'skip');
  const todo = tasks.filter((result) => result.status === 'todo');

  return (
    [
      failed.length ? color.bold(color.red(`${failed.length} failed`)) : null,
      passed.length ? color.bold(color.green(`${passed.length} passed`)) : null,
      skipped.length ? color.yellow(`${skipped.length} skipped`) : null,
      todo.length ? color.gray(`${todo.length} todo`) : null,
    ]
      .filter(Boolean)
      .join(color.dim(' | ')) +
    (showTotal ? color.gray(` (${tasks.length})`) : '')
  );
};

export const printSummaryLog = (
  results: TestSummaryResult[],
  testResults: TestResult[],
  duration: Duration,
): void => {
  logger.log('');
  logger.log(
    `${color.gray('Test Files'.padStart(12))} ${getSummaryStatusString(results)}`,
  );
  logger.log(
    `${color.gray('Tests'.padStart(12))} ${getSummaryStatusString(testResults)}`,
  );

  logger.log(
    `${color.gray('Duration'.padStart(12))} ${prettyTime(duration.totalTime)} ${color.gray(`(build ${prettyTime(duration.buildTime)}, tests ${prettyTime(duration.testTime)}`)})`,
  );
  logger.log('');
};

export const printSummaryErrorLogs = ({
  testResults,
  rootPath,
}: { rootPath: string; testResults: TestResult[] }): void => {
  const failedTests = testResults.filter((i) => i.status === 'fail');

  if (failedTests.length === 0) {
    return;
  }

  logger.log('');
  logger.log(color.bold('  Summary of all failing tests:'));
  logger.log('');

  for (const test of failedTests) {
    const relativePath = relative(rootPath, test.testPath);
    logger.log(
      `  ${color.bgRed(' FAIL ')} ${relativePath} > ${test.prefix}${test.name}`,
    );
    if (test.errors) {
      for (const error of test.errors) {
        logger.log(color.red(`    ${error.message}`));
      }
    }
  }
};
