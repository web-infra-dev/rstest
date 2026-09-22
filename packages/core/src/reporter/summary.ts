/**
 * MIT License
 *
 * Copyright (c) 2021-Present VoidZero Inc. and Vitest contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 */
import type { SnapshotSummary } from '@vitest/snapshot';
import type {
  Duration,
  GetSourcemap,
  SerializedError,
  TestFileResult,
  TestResult,
} from '../types';
import {
  bgColor,
  color,
  formatTestPath,
  logger,
  POINTER,
  prettyTestPath,
  prettyTime,
  TEST_DELIMITER,
} from '../utils';
import { getFileSummary, getRetryErrorLabel, type StatusCounts } from './utils';

export const formatStatusCounts = (
  counts: StatusCounts,
  style: 'ansi' | 'plain',
  name = 'tests',
  showTotal = true,
): string => {
  if (counts.total === 0) {
    return style === 'ansi' ? color.dim(`no ${name}`) : `no ${name}`;
  }

  const plainParts = [
    counts.failed ? `${counts.failed} failed` : null,
    counts.passed ? `${counts.passed} passed` : null,
    counts.skipped ? `${counts.skipped} skipped` : null,
    counts.todo ? `${counts.todo} todo` : null,
  ].filter(Boolean);
  const total = showTotal && plainParts.length > 1 ? ` (${counts.total})` : '';
  if (style === 'plain') {
    return `${counts.failed ? '❌' : '✅'} ${plainParts.join(' | ')}${total}`;
  }
  const parts = [
    counts.failed ? color.bold(color.red(`${counts.failed} failed`)) : null,
    counts.passed ? color.bold(color.green(`${counts.passed} passed`)) : null,
    counts.skipped ? color.yellow(`${counts.skipped} skipped`) : null,
    counts.todo ? color.gray(`${counts.todo} todo`) : null,
  ].filter(Boolean);
  return `${parts.join(color.dim(' | '))}${color.gray(total)}`;
};

/**
 * This method is modified based on source found in
 * https://github.com/vitest-dev/vitest/blob/e8ce94cfb5520a8b69f9071cc5638a53129130d6/packages/vitest/src/node/reporters/renderers/utils.ts#L67
 */
const printSnapshotSummaryLog = (
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

  if (snapshots.filesRemovedList?.length) {
    const [head, ...tail] = snapshots.filesRemovedList;
    summary.push(`${color.gray(POINTER)} ${formatTestPath(rootDir, head!)}`);

    for (const key of tail) {
      summary.push(`  ${formatTestPath(rootDir, key)}`);
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
        `${color.gray(POINTER)} ${formatTestPath(rootDir, uncheckedFile.filePath)}`,
      );
      for (const key of uncheckedFile.keys) {
        summary.push(`  ${key}`);
      }
    }
  }

  for (const [index, snapshot] of summary.entries()) {
    const title = index === 0 ? 'Snapshots' : '';
    logger.log(`${color.gray(title.padStart(12))} ${snapshot}`);
  }
};

export const TestFileSummaryLabel: string = color.gray(
  'Test Files'.padStart(11),
);
export const TestSummaryLabel: string = color.gray('Tests'.padStart(11));
export const DurationLabel: string = color.gray('Duration'.padStart(11));

export const printSummaryLog = ({
  results,
  snapshotSummary,
  duration,
  summary,
  rootPath,
}: {
  results: TestFileResult[];
  snapshotSummary: SnapshotSummary;
  duration: Duration;
  summary: { tests: StatusCounts };
  rootPath: string;
}): void => {
  logger.log('');
  printSnapshotSummaryLog(snapshotSummary, rootPath);
  logger.log(
    `${TestFileSummaryLabel} ${formatStatusCounts(getFileSummary(results), 'ansi')}`,
  );
  logger.log(
    `${TestSummaryLabel} ${formatStatusCounts(summary.tests, 'ansi')}`,
  );

  logger.log(
    `${DurationLabel} ${prettyTime(duration.totalTime)} ${color.gray(`(build ${prettyTime(duration.buildTime)}, tests ${prettyTime(duration.testTime)})`)}`,
  );
  logger.log('');
};

export const printSummaryErrorLogs = async ({
  testResults,
  results,
  rootPath,
  unhandledErrors,
  getSourcemap,
  rerunTestPaths,
}: {
  rootPath: string;
  results: TestFileResult[];
  testResults: TestResult[];
  getSourcemap: GetSourcemap;
  rerunTestPaths?: string[];
  unhandledErrors: SerializedError[];
}): Promise<boolean> => {
  // An empty watch cycle keeps the full session failure list.
  const rerun = rerunTestPaths?.length ? new Set(rerunTestPaths) : undefined;
  const failedTests: TestResult[] = [
    ...results.filter(
      (i) =>
        i.status === 'failed' &&
        i.errors?.length &&
        (rerun ? rerun.has(i.testPath) : true),
    ),
    ...testResults.filter(
      (i) => i.status === 'failed' && (rerun ? rerun.has(i.testPath) : true),
    ),
  ];

  if (failedTests.length === 0 && !unhandledErrors.length) {
    return false;
  }

  logger.stderr('');
  logger.stderr(color.bold('Summary of all failing tests:'));
  logger.stderr('');

  const { printError } = await import('../utils/error');
  for (const error of unhandledErrors) {
    logger.stderr(bgColor('bgRed', ' Unhandled Error '));
    await printError(error, getSourcemap, rootPath);
  }

  for (const test of failedTests) {
    const relativePath = test.relativeTestPath;
    const nameStr = test.fullName;

    //  FAIL  tests/index.test.ts > suite name > test case name
    logger.stderr(
      `${bgColor('bgRed', ' FAIL ')} ${prettyTestPath(relativePath)} ${nameStr.length ? `${color.dim(TEST_DELIMITER)} ${nameStr}` : ''}`,
    );

    if (test.errors) {
      const { printError } = await import('../utils/error');
      for (const error of test.errors) {
        const retryLabel = getRetryErrorLabel(error);
        if (retryLabel) {
          logger.stderr(color.yellow(`  ${retryLabel}:`));
        }
        await printError(error, getSourcemap, rootPath);
      }
    }
  }

  return true;
};
