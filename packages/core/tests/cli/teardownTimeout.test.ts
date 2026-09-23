import { afterEach, expect, it, rs } from '@rstest/core';
import { scheduleHostExit } from '../../src/cli/teardownTimeout';
import { flushOutputStreams, logger } from '../../src/utils/logger';

rs.mock('../../src/utils/logger', () => ({
  flushOutputStreams: rs.fn().mockResolvedValue(undefined),
  logger: { warn: rs.fn() },
}));

const originalExitCode = process.exitCode;

afterEach(() => {
  process.exitCode = originalExitCode;
  rs.useRealTimers();
  rs.restoreAllMocks();
  rs.clearAllMocks();
});

it('flushes before immediate exit without scheduling a timer or warning', async () => {
  const exit = rs
    .spyOn(process, 'exit')
    .mockImplementation(() => undefined as never);
  const timer = rs.spyOn(globalThis, 'setTimeout');
  let finishFlush = () => {};
  rs.mocked(flushOutputStreams).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishFlush = resolve;
      }),
  );

  const done = scheduleHostExit(0);
  expect(flushOutputStreams).toHaveBeenCalledTimes(1);
  expect(exit).not.toHaveBeenCalled();
  finishFlush();
  await done;

  expect(exit).toHaveBeenCalledExactlyOnceWith();
  expect(timer).not.toHaveBeenCalled();
  expect(logger.warn).not.toHaveBeenCalled();
});

it('calls unref on the timer, warns once at the deadline, and preserves the exit code', async () => {
  rs.useFakeTimers();
  const exit = rs
    .spyOn(process, 'exit')
    .mockImplementation(() => undefined as never);
  const setFakeTimeout = globalThis.setTimeout;
  const timer = rs
    .spyOn(globalThis, 'setTimeout')
    .mockImplementation((callback, delay) => {
      const handle = setFakeTimeout(callback, delay);
      rs.spyOn(handle, 'unref');
      return handle;
    });
  process.exitCode = 1;

  await scheduleHostExit(500);
  const handle = timer.mock.results[0]!.value;
  expect(handle.unref).toHaveBeenCalledTimes(1);
  expect(handle.hasRef()).toBe(false);
  await rs.advanceTimersByTimeAsync(499);
  expect(exit).not.toHaveBeenCalled();
  expect(logger.warn).not.toHaveBeenCalled();
  await rs.advanceTimersByTimeAsync(1);
  expect(logger.warn).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledWith(
    expect.stringContaining('did not exit 500ms'),
  );
  expect(flushOutputStreams).toHaveBeenCalledTimes(2);
  expect(exit).toHaveBeenCalledExactlyOnceWith();
  expect(process.exitCode).toBe(1);
  await rs.advanceTimersByTimeAsync(500);
  expect(logger.warn).toHaveBeenCalledTimes(1);
});
