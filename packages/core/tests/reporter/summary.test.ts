import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it, onTestFinished, rs } from '@rstest/core';
import { DefaultReporter } from '../../src/reporter/index';
import { emptyRunEndPayload, emptySnapshotSummary } from './helpers';
import type {
  Duration,
  NormalizedConfig,
  RstestTestState,
  TestFileResult,
  TestResult,
} from '../../src/types';

const baseConfig = {
  hideSkippedTestFiles: false,
  hideSkippedTests: false,
  slowTestThreshold: 300,
} as NormalizedConfig;

const duration: Duration = {
  totalTime: 500,
  buildTime: 100,
  testTime: 300,
};

const createTestState = (results: TestFileResult[]): RstestTestState => ({
  getRunningModules: () => new Map(),
  getTestModules: () => results,
  getTestFiles: () => results.map((result) => result.testPath),
});

const createFailureResults = () => {
  const testResult: TestResult = {
    status: 'failed',
    name: 'should fail',
    fullName: 'suite  should fail',
    testPath: '/test/root/example.test.ts',
    relativeTestPath: 'example.test.ts',
    duration: 200,
    errors: [
      {
        message: 'Snapshot `example 1` mismatched',
        name: 'Error',
        diff: '- Expected\n+ Received',
      },
    ],
    parentNames: ['suite'],
    project: 'default',
    testId: 'case-1',
  };

  const fileResult: TestFileResult = {
    status: 'failed',
    name: 'example.test.ts',
    fullName: 'example.test.ts',
    testPath: '/test/root/example.test.ts',
    relativeTestPath: 'example.test.ts',
    duration: 300,
    errors: testResult.errors,
    results: [testResult],
    project: 'default',
    testId: 'file-1',
    summary: { total: 1, passed: 0, failed: 1, skipped: 0, todo: 0, flaky: 0 },
  };

  return { fileResult, testResult };
};

const spyOnConsole = () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  rs.spyOn(console, 'log').mockImplementation((...args) => {
    stdout.push(args.join(' '));
  });
  rs.spyOn(console, 'error').mockImplementation((...args) => {
    stderr.push(args.join(' '));
  });

  onTestFinished(() => {
    rs.resetAllMocks();
  });

  return { stdout, stderr };
};

describe('DefaultReporter summary streams', () => {
  it('flushes error output before printing the failed summary to stdout', async () => {
    const { fileResult, testResult } = createFailureResults();
    const { stdout, stderr } = spyOnConsole();
    const writes: string[] = [];

    // `write` is overloaded and the mock signature only reflects the encoding
    // form, so the 2-arg callback has to be recovered by hand.
    const recordWrite =
      (label: string) =>
      (
        _chunk: unknown,
        encodingOrCallback?: unknown,
        callback?: unknown,
      ): boolean => {
        writes.push(label);
        const done = (
          typeof encodingOrCallback === 'function'
            ? encodingOrCallback
            : callback
        ) as (() => void) | undefined;
        done?.();
        return true;
      };
    rs.spyOn(process.stderr, 'write').mockImplementation(
      recordWrite('flush stderr'),
    );
    rs.spyOn(process.stdout, 'write').mockImplementation(
      recordWrite('flush stdout'),
    );

    const reporter = new DefaultReporter({
      rootPath: '/test/root',
      config: baseConfig,
      options: {},
      testState: createTestState([fileResult]),
    });

    await reporter.onTestRunEnd({
      ...emptyRunEndPayload,
      results: [fileResult],
      testResults: [testResult],
      duration,
      snapshotSummary: {
        ...emptySnapshotSummary,
        unmatched: 1,
      },
    });

    const stderrText = stripVTControlCharacters(stderr.join('\n'));
    const stdoutText = stripVTControlCharacters(stdout.join('\n'));

    expect(writes).toEqual(['flush stderr', 'flush stdout']);
    expect(stderrText).toContain('Summary of all failing tests:');
    expect(stderrText).toContain('FAIL  example.test.ts > suite > should fail');
    expect(stderrText).toContain('Error: Snapshot `example 1` mismatched');
    expect(stdoutText).toContain('Snapshots 1 failed');
    expect(stdoutText).toContain('Test Files 1 failed');
    expect(stdoutText).toContain('Tests 1 failed');
    expect(stdoutText).toContain('Duration 500ms (build 100ms, tests 300ms)');
  });

  it('labels retry errors by attempt in the failing summary', async () => {
    const testResult: TestResult = {
      status: 'failed',
      name: 'fails after retries',
      fullName: 'fails after retries',
      testPath: '/test/root/retry.test.ts',
      relativeTestPath: 'retry.test.ts',
      duration: 200,
      errors: [
        {
          message: 'first failure',
          name: 'Error',
          retryCount: 0,
        },
        {
          message: 'retry failure',
          name: 'Error',
          retryCount: 1,
        },
      ],
      project: 'default',
      testId: 'case-1',
    };

    const fileResult: TestFileResult = {
      status: 'failed',
      name: 'retry.test.ts',
      fullName: 'retry.test.ts',
      testPath: '/test/root/retry.test.ts',
      relativeTestPath: 'retry.test.ts',
      duration: 300,
      results: [testResult],
      project: 'default',
      testId: 'file-1',
      summary: {
        total: 1,
        passed: 0,
        failed: 1,
        skipped: 0,
        todo: 0,
        flaky: 0,
      },
    };

    const { stderr } = spyOnConsole();

    const reporter = new DefaultReporter({
      rootPath: '/test/root',
      config: baseConfig,
      options: {},
      testState: createTestState([fileResult]),
    });

    await reporter.onTestRunEnd({
      ...emptyRunEndPayload,
      results: [fileResult],
      testResults: [testResult],
      duration,
    });

    const stderrText = stripVTControlCharacters(stderr.join('\n'));

    expect(stderrText).not.toContain('Initial attempt:');
    expect(stderrText).toContain('Error: first failure');
    expect(stderrText).toContain('Retry x1:');
    expect(stderrText).toContain('Error: retry failure');
  });

  it('does not flush process streams when using a custom logger', async () => {
    const { fileResult, testResult } = createFailureResults();
    const { stdout, stderr } = spyOnConsole();
    const stdoutWrite = rs.spyOn(process.stdout, 'write');
    const stderrWrite = rs.spyOn(process.stderr, 'write');

    const reporter = new DefaultReporter({
      rootPath: '/test/root',
      config: baseConfig,
      options: {
        logger: {
          outputStream: process.stdout,
          errorStream: process.stderr,
          getColumns: () => 80,
        },
      },
      testState: createTestState([fileResult]),
    });

    await reporter.onTestRunEnd({
      ...emptyRunEndPayload,
      results: [fileResult],
      testResults: [testResult],
      duration,
    });

    expect(stdoutWrite).not.toHaveBeenCalled();
    expect(stderrWrite).not.toHaveBeenCalled();
    expect(stripVTControlCharacters(stderr.join('\n'))).toContain(
      'Summary of all failing tests:',
    );
    expect(stripVTControlCharacters(stdout.join('\n'))).toContain(
      'Test Files 1 failed',
    );
  });

  it('keeps the summary on stdout when there are no failures', async () => {
    const testResult: TestResult = {
      status: 'passed',
      name: 'should pass',
      fullName: 'should pass',
      testPath: '/test/root/example.test.ts',
      relativeTestPath: 'example.test.ts',
      duration: 200,
      project: 'default',
      testId: 'case-1',
    };
    const fileResult: TestFileResult = {
      status: 'passed',
      name: 'example.test.ts',
      fullName: 'example.test.ts',
      testPath: '/test/root/example.test.ts',
      relativeTestPath: 'example.test.ts',
      duration: 300,
      results: [testResult],
      project: 'default',
      testId: 'file-1',
      summary: {
        total: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
        todo: 0,
        flaky: 0,
      },
    };
    const { stdout, stderr } = spyOnConsole();
    const write = rs.spyOn(process.stdout, 'write');

    const reporter = new DefaultReporter({
      rootPath: '/test/root',
      config: baseConfig,
      options: {},
      testState: createTestState([fileResult]),
    });

    await reporter.onTestRunEnd({
      ...emptyRunEndPayload,
      results: [fileResult],
      testResults: [testResult],
      duration,
    });

    const stdoutText = stripVTControlCharacters(stdout.join('\n'));

    expect(stderr).toEqual([]);
    expect(write).not.toHaveBeenCalled();
    expect(stdoutText).toContain('Test Files 1 passed');
    expect(stdoutText).toContain('Tests 1 passed');
    expect(stdoutText).toContain('Duration 500ms (build 100ms, tests 300ms)');
  });
});
