import type { SnapshotSummary } from '@vitest/snapshot';
import path from 'pathe';
import type {
  Duration,
  GetSourcemap,
  TestFileResult,
  TestResult,
} from '../types';
import {
  TEST_DELIMITER,
  color,
  formatTestPath,
  getTaskNameWithPrefix,
  logger,
  prettyTime,
} from '../utils';

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

  const status = [
    failed.length ? color.bold(color.red(`${failed.length} failed`)) : null,
    passed.length ? color.bold(color.green(`${passed.length} passed`)) : null,
    skipped.length ? color.yellow(`${skipped.length} skipped`) : null,
    todo.length ? color.gray(`${todo.length} todo`) : null,
  ].filter(Boolean);

  return (
    status.join(color.dim(' | ')) +
    (showTotal && status.length > 1 ? color.gray(` (${tasks.length})`) : '')
  );
};

/**
 * This method is modified based on source found in
 * https://github.com/vitest-dev/vitest/blob/e8ce94cfb5520a8b69f9071cc5638a53129130d6/packages/vitest/src/node/reporters/renderers/utils.ts#L67
 */
export const printSnapshotSummaryLog = (
  snapshots: SnapshotSummary,
  rootDir: string,
): void => {
  const summary: string[] = [];

  if (snapshots.added) {
    summary.push(color.bold(color.green(`${snapshots.added} written`)));
  }
  if (snapshots.unmatched) {
    summary.push(color.bold(color.red(`${snapshots.unmatched} failed`)));
  }
  if (snapshots.updated) {
    summary.push(color.bold(color.green(`${snapshots.updated} updated `)));
  }

  if (snapshots.filesRemoved) {
    if (snapshots.didUpdate) {
      summary.push(
        color.bold(color.green(`${snapshots.filesRemoved} files removed `)),
      );
    } else {
      summary.push(
        color.bold(color.yellow(`${snapshots.filesRemoved} files obsolete `)),
      );
    }
  }
  const F_DOWN_RIGHT = '↳';

  if (snapshots.filesRemovedList?.length) {
    const [head, ...tail] = snapshots.filesRemovedList;
    summary.push(
      `${color.gray(F_DOWN_RIGHT)} ${formatTestPath(rootDir, head!)}`,
    );

    for (const key of tail) {
      summary.push(
        `  ${color.gray(F_DOWN_RIGHT)} ${formatTestPath(rootDir, key)}`,
      );
    }
  }

  if (snapshots.unchecked) {
    if (snapshots.didUpdate) {
      summary.push(color.bold(color.green(`${snapshots.unchecked} removed`)));
    } else {
      summary.push(color.bold(color.yellow(`${snapshots.unchecked} obsolete`)));
    }

    for (const uncheckedFile of snapshots.uncheckedKeysByFile) {
      summary.push(
        `${color.gray(F_DOWN_RIGHT)} ${formatTestPath(rootDir, uncheckedFile.filePath)}`,
      );
      for (const key of uncheckedFile.keys) {
        summary.push(`  ${color.gray(F_DOWN_RIGHT)} ${key}`);
      }
    }
  }

  for (const [index, snapshot] of summary.entries()) {
    const title = index === 0 ? 'Snapshots' : '';
    logger.log(`${color.gray(title.padStart(12))} ${snapshot}`);
  }
};

export const printSummaryLog = ({
  results,
  testResults,
  snapshotSummary,
  duration,
  rootPath,
}: {
  results: TestFileResult[];
  testResults: TestResult[];
  snapshotSummary: SnapshotSummary;
  duration: Duration;
  rootPath: string;
}): void => {
  logger.log('');
  printSnapshotSummaryLog(snapshotSummary, rootPath);
  logger.log(
    `${color.gray('Test Files'.padStart(11))} ${getSummaryStatusString(results)}`,
  );
  logger.log(
    `${color.gray('Tests'.padStart(11))} ${getSummaryStatusString(testResults)}`,
  );

  logger.log(
    `${color.gray('Duration'.padStart(11))} ${prettyTime(duration.totalTime)} ${color.gray(`(build ${prettyTime(duration.buildTime)}, tests ${prettyTime(duration.testTime)})`)}`,
  );
  logger.log('');
};

export const printSummaryErrorLogs = async ({
  testResults,
  results,
  rootPath,
  getSourcemap,
}: {
  rootPath: string;
  results: TestFileResult[];
  testResults: TestResult[];
  getSourcemap: GetSourcemap;
}): Promise<void> => {
  const failedTests: TestResult[] = [
    ...results.filter((i) => i.status === 'fail' && i.errors?.length),
    ...testResults.filter((i) => i.status === 'fail'),
  ];

  if (failedTests.length === 0) {
    return;
  }

  logger.log('');
  logger.log(color.bold('Summary of all failing tests:'));
  logger.log('');

  for (const test of failedTests) {
    const relativePath = path.relative(rootPath, test.testPath);
    const nameStr = getTaskNameWithPrefix(test);

    //  FAIL  tests/index.test.ts > suite name > test case name
    logger.log(
      `${color.bgRed(' FAIL ')} ${relativePath} ${nameStr.length ? `${TEST_DELIMITER} ${nameStr}` : ''}`,
    );

    if (test.errors) {
      const { printError } = await import('../utils/error');
      for (const error of test.errors) {
        await printError(error, getSourcemap);
      }
    }
  }
};
