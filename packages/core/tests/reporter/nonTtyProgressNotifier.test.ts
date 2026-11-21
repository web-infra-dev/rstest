import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';
import { DefaultReporter } from '../../src/reporter/index';
import { NonTTYProgressNotifier } from '../../src/reporter/nonTtyProgressNotifier';
import { VerboseReporter } from '../../src/reporter/verbose';
import { emptyFileSummary } from './helpers';
import type {
  NormalizedConfig,
  RstestTestState,
  TestFileResult,
} from '../../src/types';

const REPORT_INTERVAL_MS = 30_000;

const testState: RstestTestState = {
  getRunningModules: () => new Map(),
  getTestModules: () => [],
  getTestFiles: () => undefined,
};

beforeEach(() => {
  rs.useFakeTimers();
});

afterEach(() => {
  rs.useRealTimers();
  rs.restoreAllMocks();
});

describe('NonTTYProgressNotifier', () => {
  it('stops after 20 reports when nothing else is written', () => {
    const log = rs.spyOn(console, 'log').mockImplementation(() => {});
    const notifier = new NonTTYProgressNotifier(testState);

    notifier.start();
    rs.advanceTimersByTime(30 * REPORT_INTERVAL_MS);

    expect(log).toHaveBeenCalledTimes(20);
    notifier.stop();
  });

  it('counts the 20 reports again after other output', () => {
    const log = rs.spyOn(console, 'log').mockImplementation(() => {});
    const notifier = new NonTTYProgressNotifier(testState);

    notifier.start();
    rs.advanceTimersByTime(20 * REPORT_INTERVAL_MS);
    notifier.notifyOutput();
    rs.advanceTimersByTime(20 * REPORT_INTERVAL_MS);

    expect(log).toHaveBeenCalledTimes(40);
    notifier.stop();
  });

  it('measures each watch run from its own start', () => {
    const log = rs.spyOn(console, 'log').mockImplementation(() => {});
    const notifier = new NonTTYProgressNotifier(testState);

    notifier.start();
    rs.advanceTimersByTime(2 * REPORT_INTERVAL_MS);
    notifier.stop();
    rs.advanceTimersByTime(10 * 60_000);
    notifier.start();
    rs.advanceTimersByTime(REPORT_INTERVAL_MS);

    expect(log).toHaveBeenLastCalledWith('[PROGRESS] test files: 0 done | 30s');
    notifier.stop();
  });

  it('gives each watch run its own 20 reports', () => {
    const log = rs.spyOn(console, 'log').mockImplementation(() => {});
    const notifier = new NonTTYProgressNotifier(testState);

    notifier.start();
    rs.advanceTimersByTime(20 * REPORT_INTERVAL_MS);
    notifier.stop();
    notifier.start();
    rs.advanceTimersByTime(20 * REPORT_INTERVAL_MS);

    expect(log).toHaveBeenCalledTimes(40);
    notifier.stop();
  });
});

describe.each([
  { name: 'DefaultReporter', Reporter: DefaultReporter },
  { name: 'VerboseReporter', Reporter: VerboseReporter },
])('$name progress reports', ({ Reporter }) => {
  const config = {
    hideSkippedTestFiles: true,
    hideSkippedTests: false,
    slowTestThreshold: 300,
  } as NormalizedConfig;

  const createFileResult = (
    status: TestFileResult['status'],
  ): TestFileResult => ({
    testId: 'file-1',
    status,
    name: 'example.test.ts',
    fullName: 'example.test.ts',
    testPath: '/root/example.test.ts',
    relativeTestPath: 'example.test.ts',
    duration: 10,
    results: [],
    project: 'default',
    summary: emptyFileSummary,
  });

  const spyOnProgress = () => {
    const reports: string[] = [];
    rs.spyOn(console, 'log').mockImplementation((line) => {
      if (String(line).startsWith('[PROGRESS]')) {
        reports.push(String(line));
      }
    });
    return reports;
  };

  beforeEach(() => {
    // Off a TTY, which `CI` forces, the reporter reports progress this way.
    rs.stubEnv('CI', 'true');
  });

  afterEach(() => {
    rs.unstubAllEnvs();
  });

  it('does not count a skipped file hidden by hideSkippedTestFiles as output', () => {
    const reports = spyOnProgress();
    const reporter = new Reporter({
      rootPath: '/root',
      config,
      options: {},
      testState,
    });

    reporter.onTestFileStart();
    rs.advanceTimersByTime(20 * REPORT_INTERVAL_MS);
    reporter.onTestFileResult(createFileResult('skipped'));
    rs.advanceTimersByTime(20 * REPORT_INTERVAL_MS);

    expect(reports).toHaveLength(20);
    reporter.onExit();
  });

  it('counts a printed file result as output', () => {
    const reports = spyOnProgress();
    const reporter = new Reporter({
      rootPath: '/root',
      config,
      options: {},
      testState,
    });

    reporter.onTestFileStart();
    rs.advanceTimersByTime(20 * REPORT_INTERVAL_MS);
    reporter.onTestFileResult(createFileResult('passed'));
    rs.advanceTimersByTime(20 * REPORT_INTERVAL_MS);

    expect(reports).toHaveLength(40);
    reporter.onExit();
  });
});
