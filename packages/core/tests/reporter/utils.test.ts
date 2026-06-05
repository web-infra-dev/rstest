import { describe, expect, it } from '@rstest/core';
import { deriveRunCounts } from '../../src/reporter/utils';
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

describe('deriveRunCounts', () => {
  it('partitions test results by status and derives the 7-field counts struct', () => {
    const testResults = [
      test('pass', '1'),
      test('pass', '2'),
      test('fail', '3'),
      test('skip', '4'),
      test('todo', '5'),
    ];
    const results = [file('pass', 'a'), file('fail', 'b')];

    const derived = deriveRunCounts({ results, testResults });

    expect(derived.passedTests.map((t) => t.testId)).toEqual(['1', '2']);
    expect(derived.failedTests.map((t) => t.testId)).toEqual(['3']);
    expect(derived.skippedTests.map((t) => t.testId)).toEqual(['4']);
    expect(derived.todoTests.map((t) => t.testId)).toEqual(['5']);
    expect(derived.failedFiles.map((f) => f.testId)).toEqual(['b']);

    expect(derived.counts).toEqual({
      testFiles: 2,
      failedFiles: 1,
      tests: 5,
      failedTests: 1,
      passedTests: 2,
      skippedTests: 1,
      todoTests: 1,
    });
  });

  it('returns zeroed counts for an empty run', () => {
    const derived = deriveRunCounts({ results: [], testResults: [] });

    expect(derived.failedTests).toEqual([]);
    expect(derived.failedFiles).toEqual([]);
    expect(derived.counts).toEqual({
      testFiles: 0,
      failedFiles: 0,
      tests: 0,
      failedTests: 0,
      passedTests: 0,
      skippedTests: 0,
      todoTests: 0,
    });
  });
});
