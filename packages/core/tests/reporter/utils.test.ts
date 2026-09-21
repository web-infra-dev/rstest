import { describe, expect, it } from '@rstest/core';
import { stripVTControlCharacters } from 'node:util';
import { formatStatusCounts } from '../../src/reporter/summary';
import { computeSummary, truncateString } from '../../src/reporter/utils';
import type { TestFileResult, TestResult } from '../../src/types';

const test = (status: TestResult['status'], id: string): TestResult => ({
  status,
  name: `test-${id}`,
  fullName: `test-${id}`,
  testPath: '/root/file.test.ts',
  relativeTestPath: 'file.test.ts',
  project: 'default',
  testId: id,
});

const file = (
  status: TestFileResult['status'],
  id: string,
): TestFileResult => ({
  status,
  name: `file-${id}`,
  fullName: `file-${id}`,
  testPath: `/root/file-${id}.test.ts`,
  relativeTestPath: `file-${id}.test.ts`,
  results: [],
  summary: { total: 0, passed: 0, failed: 0, skipped: 0, todo: 0, flaky: 0 },
  project: 'default',
  testId: id,
});

describe('computeSummary', () => {
  it('counts file and nested test results by status', () => {
    const testResults = [
      test('passed', '1'),
      test('passed', '2'),
      test('failed', '3'),
      test('skipped', '4'),
      test('todo', '5'),
    ];
    const passedFile = file('passed', 'a');
    passedFile.results = testResults;
    passedFile.summary = {
      total: 5,
      passed: 2,
      failed: 1,
      skipped: 1,
      todo: 1,
      flaky: 0,
    };

    expect(computeSummary([passedFile, file('failed', 'b')])).toEqual({
      tests: {
        total: 5,
        passed: 2,
        failed: 1,
        skipped: 1,
        todo: 1,
        flaky: 0,
      },
      files: { total: 2, failed: 1 },
    });
  });

  it('counts only passed tests that retried as flaky', () => {
    const passedAfterRetry = test('passed', 'passed-after-retry');
    passedAfterRetry.retryCount = 1;
    const failedAfterRetry = test('failed', 'failed-after-retry');
    failedAfterRetry.retryCount = 2;
    const passedWithoutRetry = test('passed', 'passed-without-retry');
    passedWithoutRetry.retryCount = 0;
    const resultFile = file('failed', 'retries');
    resultFile.results = [
      passedAfterRetry,
      failedAfterRetry,
      passedWithoutRetry,
    ];
    resultFile.summary = {
      total: 3,
      passed: 2,
      failed: 1,
      skipped: 0,
      todo: 0,
      flaky: 1,
    };

    expect(computeSummary([resultFile])).toEqual({
      tests: {
        total: 3,
        passed: 2,
        failed: 1,
        skipped: 0,
        todo: 0,
        flaky: 1,
      },
      files: { total: 1, failed: 1 },
    });
  });
});

describe('shared reporter formatters', () => {
  it('formats asymmetric counts in ANSI and plain styles', () => {
    const counts = {
      total: 10,
      passed: 6,
      failed: 1,
      skipped: 2,
      todo: 1,
      flaky: 0,
    };

    expect(formatStatusCounts(counts, 'plain')).toBe(
      '❌ 1 failed | 6 passed | 2 skipped | 1 todo (10)',
    );
    expect(stripVTControlCharacters(formatStatusCounts(counts, 'ansi'))).toBe(
      '1 failed | 6 passed | 2 skipped | 1 todo (10)',
    );
  });

  it('preserves each truncation suffix and character budget', () => {
    expect(truncateString('abcdefgh', 5, '…')).toBe('abcd…');
    expect(truncateString('abcdefgh', 5, '... [truncated]')).toBe('... [');
  });
});
