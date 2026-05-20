import { describe, expect, it, onTestFinished, rs } from '@rstest/core';
import { JsonReporter } from '../../src/reporter/json';
import type { Duration, TestFileResult, TestResult } from '../../src/types';
import { emptySnapshotSummary, makeRunReport } from './_fixtures';

describe('JsonReporter', () => {
  it('should create JSON report correctly', async () => {
    const reporter = new JsonReporter({
      rootPath: '/test/root',
      options: {},
    });

    const mockTestResults: TestResult[] = [
      {
        status: 'pass',
        name: 'should pass',
        testPath: '/test/root/test1.test.ts',
        duration: 100,
        project: 'default',
        testId: '1',
      },
      {
        status: 'fail',
        name: 'should fail',
        testPath: '/test/root/test1.test.ts',
        duration: 200,
        errors: [
          {
            message: 'Test failed',
            name: 'AssertionError',
            stack: 'Error: Test failed',
          },
        ],
        project: 'default',
        testId: '2',
      },
      {
        status: 'skip',
        name: 'should skip',
        testPath: '/test/root/test1.test.ts',
        duration: 0,
        project: 'default',
        testId: '3',
      },
    ];

    const mockFileResults: TestFileResult[] = [
      {
        status: 'fail',
        name: 'test1.test.ts',
        testPath: '/test/root/test1.test.ts',
        duration: 300,
        results: mockTestResults,
        project: 'default',
        testId: 'file-1',
      },
    ];

    const mockDuration: Duration = {
      totalTime: 500,
      buildTime: 100,
      testTime: 300,
    };

    const logs: string[] = [];

    rs.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });

    onTestFinished(() => {
      rs.resetAllMocks();
    });

    await reporter.onTestRunEnd({
      results: mockFileResults,
      testResults: mockTestResults,
      duration: mockDuration,
      snapshotSummary: emptySnapshotSummary,
      runReport: makeRunReport({
        results: mockFileResults,
        testResults: mockTestResults,
        duration: mockDuration,
      }),
    });

    const report = JSON.parse(logs.join('\n'));

    expect(report.tool).toBe('rstest');
    expect(report.status).toBe('fail');
    expect(report.summary).toEqual({
      testFiles: 1,
      failedFiles: 1,
      tests: 3,
      failedTests: 1,
      passedTests: 1,
      skippedTests: 1,
      todoTests: 0,
    });
    expect(report.files[0].testPath).toBe('test1.test.ts');
    expect(report.tests[0].testPath).toBe('test1.test.ts');
    expect(report.tests[1].errors[0].message).toBe('Test failed');
  });

  it('should mark zero-test runs as failed when passWithNoTests is false', async () => {
    const reporter = new JsonReporter({
      rootPath: '/test/root',
      options: {},
    });

    const logs: string[] = [];

    rs.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });

    onTestFinished(() => {
      rs.resetAllMocks();
    });

    const zeroDuration: Duration = {
      totalTime: 0,
      buildTime: 0,
      testTime: 0,
    };

    await reporter.onTestRunEnd({
      results: [],
      testResults: [],
      duration: zeroDuration,
      snapshotSummary: emptySnapshotSummary,
      runReport: makeRunReport({
        results: [],
        testResults: [],
        duration: zeroDuration,
      }),
    });

    const report = JSON.parse(logs.join('\n'));

    expect(report.status).toBe('fail');
    expect(report.summary.tests).toBe(0);
  });
});
