import { describe, expect, it, onTestFinished, rs } from '@rstest/core';
import { TeamcityReporter } from '../../src/reporter/teamcity';
import type { Duration, TestFileResult, TestResult } from '../../src/types';

const ROOT_PATH = '/test/root';
const TEST_PATH = '/test/root/example.test.ts';
const NO_DURATION: Duration = { totalTime: 0, buildTime: 0, testTime: 0 };

function testResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    testId: 'test-id',
    status: 'pass',
    name: 'reports a case',
    parentNames: ['suite'],
    testPath: TEST_PATH,
    duration: 12,
    project: 'default',
    ...overrides,
  };
}

function fileResult(overrides: Partial<TestFileResult> = {}): TestFileResult {
  return {
    testId: TEST_PATH,
    status: 'pass',
    name: 'example.test.ts',
    testPath: TEST_PATH,
    duration: 12,
    project: 'default',
    results: [],
    ...overrides,
  };
}

async function run(...results: TestFileResult[]): Promise<string[]> {
  const logs: string[] = [];
  rs.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  onTestFinished(() => {
    rs.resetAllMocks();
  });

  const reporter = new TeamcityReporter({ rootPath: ROOT_PATH, options: {} });
  await reporter.onTestRunEnd({
    results,
    testResults: results.flatMap((file) => file.results),
    duration: NO_DURATION,
    getSourcemap: () => Promise.resolve(null),
  });

  return logs.filter((log) => log.includes('##teamcity['));
}

const messageType = (log: string): string =>
  log.match(/##teamcity\[(\w+)/)?.[1] ?? '';

describe('TeamcityReporter', () => {
  it('wraps each file in a balanced suite and scopes test names to the suite', async () => {
    const logs = await run(
      fileResult({
        status: 'fail',
        results: [
          testResult({ name: 'passes' }),
          testResult({
            name: 'fails',
            status: 'fail',
            errors: [
              {
                message: 'expected 1 to be 2',
                expected: '2',
                actual: '1',
                stack:
                  'AssertionError: expected 1 to be 2\n    at test (/test/root/example.test.ts:4:17)',
              },
            ],
          }),
        ],
      }),
    );

    expect(logs.map(messageType)).toEqual([
      'testSuiteStarted',
      'testStarted',
      'testFinished',
      'testStarted',
      'testFailed',
      'testFinished',
      'testSuiteFinished',
    ]);
    // suite carries the file path; test names do not repeat it
    expect(logs[0]).toContain("name='example.test.ts'");
    expect(logs[1]).toContain("name='suite > passes'");
    expect(logs[4]).toContain("type='comparisonFailure'");
    expect(logs[4]).toContain("expected='2'");
    expect(logs[4]).toContain("actual='1'");
    expect(logs[4]).toContain("name='suite > fails'");
  });

  it('emits testIgnored for skipped and todo tests', async () => {
    const logs = await run(
      fileResult({
        results: [
          testResult({ status: 'skip' }),
          testResult({ status: 'todo' }),
        ],
      }),
    );

    expect(
      logs.filter((log) => messageType(log) === 'testIgnored'),
    ).toHaveLength(2);
  });

  it('aggregates multiple errors into a single testFailed without a comparison type', async () => {
    const logs = await run(
      fileResult({
        status: 'fail',
        results: [
          testResult({
            status: 'fail',
            errors: [
              {
                message: 'first soft failure',
                stack: 'Error: first soft failure',
              },
              {
                message: 'second soft failure',
                stack: 'Error: second soft failure',
              },
            ],
          }),
        ],
      }),
    );

    const failures = logs.filter((log) => messageType(log) === 'testFailed');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(
      "message='first soft failure|nsecond soft failure'",
    );
    expect(failures[0]).not.toContain('comparisonFailure');
  });

  it('reports a file-load failure as a synthetic "file setup" test', async () => {
    const logs = await run(
      fileResult({
        status: 'fail',
        errors: [
          {
            message: "Cannot find module './missing'",
            stack: "Error: Cannot find module './missing'",
          },
        ],
      }),
    );

    expect(logs.map(messageType)).toEqual([
      'testSuiteStarted',
      'testStarted',
      'testFailed',
      'testFinished',
      'testSuiteFinished',
    ]);
    expect(logs[1]).toContain("name='file setup'");
    expect(logs[2]).toContain("message='Cannot find module |'./missing|''");
  });

  it('escapes service-message values', async () => {
    const logs = await run(
      fileResult({
        status: 'fail',
        results: [
          testResult({
            name: "it's [special]",
            parentNames: [],
            status: 'fail',
            errors: [{ message: 'line one\nline two' }],
          }),
        ],
      }),
    );

    const started = logs.find((log) => messageType(log) === 'testStarted')!;
    const failed = logs.find((log) => messageType(log) === 'testFailed')!;
    expect(started).toContain("name='it|'s |[special|]'");
    expect(failed).toContain("message='line one|nline two'");
  });
});
