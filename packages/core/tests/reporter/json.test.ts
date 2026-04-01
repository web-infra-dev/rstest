import { describe, expect, it, onTestFinished, rs } from '@rstest/core';
import { JsonReporter } from '../../src/reporter/json';
import type {
  Duration,
  NormalizedConfig,
  SnapshotSummary,
  TestFileResult,
  TestResult,
} from '../../src/types';

const baseConfig = {
  passWithNoTests: false,
} as NormalizedConfig;

const emptySnapshotSummary: SnapshotSummary = {
  added: 0,
  didUpdate: false,
  failure: false,
  filesAdded: 0,
  filesRemoved: 0,
  filesRemovedList: [],
  filesUnmatched: 0,
  filesUpdated: 0,
  matched: 0,
  total: 0,
  unchecked: 0,
  uncheckedKeysByFile: [],
  unmatched: 0,
  updated: 0,
};

describe('JsonReporter', () => {
  it('should create JSON report correctly', async () => {
    const reporter = new JsonReporter({
      config: baseConfig,
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
      config: baseConfig,
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

    await reporter.onTestRunEnd({
      results: [],
      testResults: [],
      duration: {
        totalTime: 0,
        buildTime: 0,
        testTime: 0,
      },
      snapshotSummary: emptySnapshotSummary,
    });

    const report = JSON.parse(logs.join('\n'));

    expect(report.status).toBe('fail');
    expect(report.summary.tests).toBe(0);
  });
});
