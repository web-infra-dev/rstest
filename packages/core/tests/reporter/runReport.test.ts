import { describe, expect, it } from '@rstest/core';
import { buildRunReport } from '../../src/reporter/runReport';
import type { TestFileResult, TestResult } from '../../src/types';
import { emptyDuration, emptySnapshotSummary } from './_fixtures';

const makeTest = (
  status: TestResult['status'],
  testPath = '/repo/x.test.ts',
  errors: TestResult['errors'] = undefined,
): TestResult => ({
  status,
  name: `${status} case`,
  testPath,
  duration: 1,
  project: 'default',
  testId: `${status}-${testPath}`,
  errors,
});

const makeFile = (
  status: TestFileResult['status'],
  testPath = '/repo/x.test.ts',
  errors: TestFileResult['errors'] = undefined,
): TestFileResult => ({
  status,
  testPath,
  duration: 1,
  project: 'default',
  name: testPath,
  results: [],
  errors,
});

describe('buildRunReport / status predicate', () => {
  const cases: Array<{
    name: string;
    input: Parameters<typeof buildRunReport>[0];
    expected: 'pass' | 'fail';
  }> = [
    {
      name: 'all tests pass → pass',
      input: {
        results: [makeFile('pass')],
        testResults: [makeTest('pass')],
        snapshotSummary: emptySnapshotSummary,
        duration: emptyDuration,
        passWithNoTests: false,
      },
      expected: 'pass',
    },
    {
      name: 'any failed test → fail',
      input: {
        results: [makeFile('fail')],
        testResults: [
          makeTest('pass'),
          makeTest('fail', '/repo/x.test.ts', [
            { message: 'boom', name: 'AssertionError' },
          ]),
        ],
        snapshotSummary: emptySnapshotSummary,
        duration: emptyDuration,
        passWithNoTests: false,
      },
      expected: 'fail',
    },
    {
      name: 'failed file with zero failed cases → fail (file-level failure)',
      input: {
        results: [makeFile('fail', '/repo/x.test.ts', [{ message: 'crash' }])],
        testResults: [],
        snapshotSummary: emptySnapshotSummary,
        duration: emptyDuration,
        passWithNoTests: false,
      },
      expected: 'fail',
    },
    {
      name: 'unhandledErrors only → fail',
      input: {
        results: [makeFile('pass')],
        testResults: [makeTest('pass')],
        unhandledErrors: [new Error('rogue')],
        snapshotSummary: emptySnapshotSummary,
        duration: emptyDuration,
        passWithNoTests: false,
      },
      expected: 'fail',
    },
    {
      name: 'no tests + passWithNoTests=false → fail',
      input: {
        results: [],
        testResults: [],
        snapshotSummary: emptySnapshotSummary,
        duration: emptyDuration,
        passWithNoTests: false,
      },
      expected: 'fail',
    },
    {
      name: 'no tests + passWithNoTests=true → pass',
      input: {
        results: [],
        testResults: [],
        snapshotSummary: emptySnapshotSummary,
        duration: emptyDuration,
        passWithNoTests: true,
      },
      expected: 'pass',
    },
    {
      name: 'skipped/todo only → pass',
      input: {
        results: [makeFile('pass')],
        testResults: [makeTest('skip'), makeTest('todo')],
        snapshotSummary: emptySnapshotSummary,
        duration: emptyDuration,
        passWithNoTests: false,
      },
      expected: 'pass',
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const report = buildRunReport(c.input);
      expect(report.status).toBe(c.expected);
    });
  }
});

describe('buildRunReport / counts', () => {
  it('counts every status across files and tests', () => {
    const report = buildRunReport({
      results: [
        makeFile('pass', '/repo/a.test.ts'),
        makeFile('fail', '/repo/b.test.ts'),
        makeFile('pass', '/repo/c.test.ts'),
      ],
      testResults: [
        makeTest('pass', '/repo/a.test.ts'),
        makeTest('fail', '/repo/b.test.ts', [{ message: 'x' }]),
        makeTest('fail', '/repo/b.test.ts', [{ message: 'y' }]),
        makeTest('skip', '/repo/c.test.ts'),
        makeTest('todo', '/repo/c.test.ts'),
      ],
      snapshotSummary: emptySnapshotSummary,
      duration: emptyDuration,
      passWithNoTests: false,
    });

    expect(report.counts).toEqual({
      testFiles: 3,
      failedFiles: 1,
      tests: 5,
      failedTests: 2,
      passedTests: 1,
      skippedTests: 1,
      todoTests: 1,
    });
  });
});

describe('buildRunReport / failures and unhandledErrors', () => {
  it('extracts failures via collectFailures and respects filterRerunTestPaths', () => {
    const report = buildRunReport({
      results: [],
      testResults: [
        makeTest('fail', '/repo/a.test.ts', [{ message: 'a-fail' }]),
        makeTest('fail', '/repo/b.test.ts', [{ message: 'b-fail' }]),
      ],
      snapshotSummary: emptySnapshotSummary,
      duration: emptyDuration,
      passWithNoTests: false,
      filterRerunTestPaths: ['/repo/a.test.ts'],
    });

    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.test.testPath).toBe('/repo/a.test.ts');
  });

  it('flattens unhandledErrors to message/stack/name', () => {
    const e = new Error('rogue');
    e.stack = 'rogue-stack';
    const report = buildRunReport({
      results: [],
      testResults: [],
      unhandledErrors: [e],
      snapshotSummary: emptySnapshotSummary,
      duration: emptyDuration,
      passWithNoTests: true,
    });

    expect(report.unhandledErrors).toEqual([
      { message: 'rogue', stack: 'rogue-stack', name: 'Error' },
    ]);
  });
});
