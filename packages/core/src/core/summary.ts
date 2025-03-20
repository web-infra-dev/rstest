import type { TestResult, TestSuiteResult } from '../types';
import { color, logger } from '../utils';

export const getStatusString = (
  tasks: TestSuiteResult[],
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
  results: TestResult[],
  testResults: TestSuiteResult[],
): void => {
  logger.log(
    `${color.gray('Test Files'.padStart(12))} ${getStatusString(results)}`,
  );
  logger.log(
    `${color.gray('Tests'.padStart(12))} ${getStatusString(testResults)}`,
  );
  logger.log('');
};
