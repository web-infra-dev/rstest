import { afterEach, expect, it, rs } from '@rstest/core';
import { createExitCode } from '../../src/core/execution/exitCode';
import { registerFatalSignalExit } from '../../src/core/execution/signalExit';
import { FATAL_SIGNALS } from '../../src/utils/signals';

afterEach(() => {
  rs.restoreAllMocks();
});

it('leaves an embedded host signal policy untouched', () => {
  const before = FATAL_SIGNALS.map((signal) => process.listeners(signal));
  const dispose = registerFatalSignalExit(
    { embedded: true, exitCode: createExitCode() },
    {
      interrupt: async () => {},
      release: async () => {},
    },
  );
  expect(FATAL_SIGNALS.map((signal) => process.listeners(signal))).toEqual(
    before,
  );
  dispose();
  expect(FATAL_SIGNALS.map((signal) => process.listeners(signal))).toEqual(
    before,
  );
});

it('raises the first signal code, interrupts, releases, and exits', async () => {
  const exitCode = createExitCode();
  const baseline = FATAL_SIGNALS.map((signal) => process.listenerCount(signal));
  const events: string[] = [];
  const exit = rs.spyOn(process, 'exit').mockReturnValue(undefined as never);
  rs.spyOn(console, 'log').mockImplementation(() => {});
  const dispose = registerFatalSignalExit(
    { embedded: false, exitCode },
    {
      interrupt: async () => {
        events.push('interrupt');
      },
      release: async () => {
        events.push('release');
      },
    },
  );
  try {
    await process.listeners('SIGINT').at(-1)!('SIGINT');
    expect(exitCode.current).toBe(130);
    expect(events).toEqual(['interrupt', 'release']);
    expect(exit).toHaveBeenCalledExactlyOnceWith(130);
  } finally {
    dispose();
  }
  expect(FATAL_SIGNALS.map((signal) => process.listenerCount(signal))).toEqual(
    baseline,
  );
});

it('still releases when interrupt rejects', async () => {
  const release = rs.fn(async () => {});
  const exit = rs.spyOn(process, 'exit').mockReturnValue(undefined as never);
  rs.spyOn(console, 'log').mockImplementation(() => {});
  const dispose = registerFatalSignalExit(
    { embedded: false, exitCode: createExitCode() },
    {
      interrupt: async () => {
        throw new Error('interrupt failed');
      },
      release,
    },
  );
  try {
    await process.listeners('SIGINT').at(-1)!('SIGINT');
    expect(release).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(130);
  } finally {
    dispose();
  }
});

it('exits immediately on a second signal without releasing twice', async () => {
  let unblock: () => void = () => {};
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const release = rs.fn(async () => blocked);
  const exit = rs.spyOn(process, 'exit').mockReturnValue(undefined as never);
  rs.spyOn(console, 'log').mockImplementation(() => {});
  const dispose = registerFatalSignalExit(
    { embedded: false, exitCode: createExitCode() },
    { interrupt: async () => {}, release },
  );
  const handle = process.listeners('SIGINT').at(-1)!;
  try {
    void handle('SIGINT');
    await expect.poll(() => release).toHaveBeenCalledTimes(1);
    await handle('SIGTERM');
    expect(exit).toHaveBeenCalledExactlyOnceWith(143);
    expect(release).toHaveBeenCalledTimes(1);
  } finally {
    unblock();
    dispose();
  }
});
