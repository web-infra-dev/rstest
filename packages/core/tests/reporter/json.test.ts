import { describe, expect, it, onTestFinished, rs } from '@rstest/core';
import { JsonReporter } from '../../src/reporter/json';
import type {
  Duration,
  NormalizedConfig,
  TestFileResult,
  TestResult,
} from '../../src/types';
import { emptySnapshotSummary } from './helpers';

const baseConfig = {
  passWithNoTests: false,
} as NormalizedConfig;

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

  describe('console logs', () => {
    const PATH_A = '/test/root/a.test.ts';
    const PATH_B = '/test/root/b.test.ts';

    const passedFile = (testPath: string, project: string): TestFileResult => ({
      testId: `${project}:${testPath}`,
      status: 'pass',
      name: testPath,
      testPath,
      project,
      results: [],
    });

    const setup = () => {
      const reporter = new JsonReporter({
        config: baseConfig,
        rootPath: '/test/root',
        options: {},
      });

      const stdout: string[] = [];
      rs.spyOn(console, 'log').mockImplementation((...args) => {
        stdout.push(args.join(' '));
      });
      onTestFinished(() => {
        rs.resetAllMocks();
      });

      return {
        fileStart: (testPath: string, project = 'default') =>
          reporter.onTestFileStart({
            testId: `${project}:${testPath}`,
            testPath,
            project,
            tests: [],
          }),
        consoleLog: (testPath: string, content: string, project = 'default') =>
          reporter.onUserConsoleLog({
            content,
            name: 'log',
            testPath,
            project,
            type: 'stdout',
          }),
        runEnd: async (results: TestFileResult[]) => {
          await reporter.onTestRunEnd({
            results,
            testResults: [],
            duration: { totalTime: 0, buildTime: 0, testTime: 0 },
            snapshotSummary: emptySnapshotSummary,
          });
          const report = JSON.parse(stdout.join('\n'));
          return (
            report.consoleLogs?.map(
              (log: { testPath: string; content: string }) =>
                `${log.testPath}: ${log.content}`,
            ) ?? []
          );
        },
      };
    };

    it('should keep only the latest logs of a rerun file, in arrival order', async () => {
      const { fileStart, consoleLog, runEnd } = setup();

      fileStart(PATH_A);
      consoleLog(PATH_A, 'a first cycle');
      fileStart(PATH_B);
      consoleLog(PATH_B, 'b only cycle');

      // Watch rerun of file A only.
      fileStart(PATH_A);
      consoleLog(PATH_A, 'a second cycle');

      expect(
        await runEnd([
          passedFile(PATH_A, 'default'),
          passedFile(PATH_B, 'default'),
        ]),
      ).toEqual(['b.test.ts: b only cycle', 'a.test.ts: a second cycle']);
    });

    it('should keep logs of other projects running the same file', async () => {
      const { fileStart, consoleLog, runEnd } = setup();

      fileStart(PATH_A, 'node');
      consoleLog(PATH_A, 'from node', 'node');
      fileStart(PATH_A, 'jsdom');
      consoleLog(PATH_A, 'from jsdom', 'jsdom');

      expect(
        await runEnd([passedFile(PATH_A, 'node'), passedFile(PATH_A, 'jsdom')]),
      ).toEqual(['a.test.ts: from node', 'a.test.ts: from jsdom']);
    });

    it('should drop logs of files that left the result snapshot', async () => {
      const { fileStart, consoleLog, runEnd } = setup();

      fileStart(PATH_A);
      consoleLog(PATH_A, 'a only cycle');
      fileStart(PATH_B);
      consoleLog(PATH_B, 'b only cycle');

      // File A was deleted, so the watch snapshot no longer lists it.
      expect(await runEnd([passedFile(PATH_B, 'default')])).toEqual([
        'b.test.ts: b only cycle',
      ]);
    });
  });
});
