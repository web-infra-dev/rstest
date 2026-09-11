import { describe, expect, it } from '@rstest/core';
import { computeSummary } from '../../src/reporter/utils';
import type { TestFileResult, TestResult } from '../../src/types';

const test = (status: TestResult['status'], id: string): TestResult =>
  ({
    status,
    name: `test-${id}`,
    testPath: '/root/file.test.ts',
    project: 'default',
    testId: id,
  }) as TestResult;

const file = (status: TestFileResult['status'], id: string): TestFileResult =>
  ({
    status,
    name: `file-${id}`,
    testPath: `/root/file-${id}.test.ts`,
    results: [],
    project: 'default',
    testId: id,
  }) as TestFileResult;

describe('computeSummary', () => {
  it('counts file and nested test results by status', () => {
    const testResults = [
      test('pass', '1'),
      test('pass', '2'),
      test('fail', '3'),
      test('skip', '4'),
      test('todo', '5'),
    ];
    const passedFile = file('pass', 'a');
    passedFile.results = testResults;

    expect(computeSummary([passedFile, file('fail', 'b')])).toEqual({
      tests: { total: 5, passed: 2, failed: 1, skipped: 1, todo: 1 },
      files: { total: 2, failed: 1 },
    });
  });
});
