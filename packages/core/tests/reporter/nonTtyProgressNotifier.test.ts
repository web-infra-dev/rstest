import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';
import { NonTTYProgressNotifier } from '../../src/reporter/nonTtyProgressNotifier';
import type { RstestTestState } from '../../src/types';

const REPORT_INTERVAL_MS = 30_000;

const testState: RstestTestState = {
  getRunningModules: () => new Map(),
  getTestModules: () => [],
  getTestFiles: () => undefined,
};

describe('NonTTYProgressNotifier', () => {
  beforeEach(() => {
    rs.useFakeTimers();
  });

  afterEach(() => {
    rs.useRealTimers();
    rs.restoreAllMocks();
  });

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
