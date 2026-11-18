import actualFs from 'node:fs' with { rstest: 'importActual' };
import { afterEach, beforeEach, expect, it, rstest } from '@rstest/core';
import { logger } from '../../src/utils/logger';
import { createRssTrace } from '../../src/utils/traceRss';

// cspell:ignore mountinfo

const io = rstest.hoisted(() => ({
  readFileSync: rstest.fn<(path: string) => string>(),
  mkdirSync: rstest.fn(),
  openSync: rstest.fn(() => 42),
  writeSync: rstest.fn(),
  closeSync: rstest.fn(),
}));
rstest.mock('node:fs', () => ({
  ...actualFs,
  ...io,
}));

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;

beforeEach(() => {
  rstest.clearAllMocks();
  Object.defineProperty(process, 'platform', { value: 'linux' });
  io.readFileSync.mockImplementation(() => {
    throw new Error('unavailable');
  });
});
afterEach(() => {
  Object.defineProperty(process, 'platform', platform);
  rstest.restoreAllMocks();
});

it('records container cgroup v2 memory and OOM counters with byte units', () => {
  const files = new Map([
    ['/proc/self/cgroup', '0::/job/test\n'],
    [
      '/proc/self/mountinfo',
      '25 22 0:22 /job /sys/fs/cgroup rw - cgroup2 cgroup rw\n',
    ],
    ['/sys/fs/cgroup/test/memory.current', '1024\n'],
    ['/sys/fs/cgroup/test/memory.max', '8589934592\n'],
    ['/sys/fs/cgroup/test/memory.peak', '2048\n'],
    [
      '/sys/fs/cgroup/test/memory.events',
      ['low 0', 'oom 2', 'oom_kill 1', ''].join('\n'),
    ],
  ]);
  io.readFileSync.mockImplementation((path) => {
    const value = files.get(path);
    if (value === undefined) throw new Error('unavailable');
    return value;
  });
  const trace = createRssTrace('/workspace', true)!;
  try {
    const record = JSON.parse(io.writeSync.mock.calls.at(-1)![1]);
    expect(record).toMatchObject({
      event: 'start',
      cgroup: {
        current: 1024,
        max: 8589934592,
        peak: 2048,
        oom: 2,
        oom_kill: 1,
      },
    });
    expect(record.rss).toBeGreaterThan(0);
    expect(record.heapUsed).toBeGreaterThan(0);
    const reads = io.readFileSync.mock.calls.length;
    trace.record('compile:start', { project: 'app' });
    trace.record('span:start', { name: 'host:get-assets-by-entry' });
    trace.record('worker:sample', { role: 'worker', pid: 123 });
    expect(io.readFileSync).toHaveBeenCalledTimes(reads);
    files.set('/sys/fs/cgroup/test/memory.max', '4294967296\n');
    trace.record('sample');
    expect(io.readFileSync).toHaveBeenCalledTimes(reads + 4);
    expect(JSON.parse(io.writeSync.mock.calls.at(-1)![1]).cgroup.max).toBe(
      4294967296,
    );
  } finally {
    trace.close();
  }
});

it('keeps recording when cgroup files are unavailable and closes once', () => {
  const trace = createRssTrace('/workspace', true)!;
  trace.record('sample');
  const record = JSON.parse(io.writeSync.mock.calls.at(-1)![1]);
  expect(record).not.toHaveProperty('cgroup');
  trace.close();
  trace.close();
  trace.record('after:close');
  expect(io.closeSync).toHaveBeenCalledTimes(1);
  expect(JSON.parse(io.writeSync.mock.calls.at(-1)![1]).event).toBe('stop');
});

it('disables the diagnostic stream after a write failure', () => {
  const warn = rstest.spyOn(logger, 'warn').mockImplementation(() => {});
  const trace = createRssTrace('/workspace', true)!;
  io.writeSync.mockImplementationOnce(() => {
    throw new Error('disk full');
  });
  trace.record('sample');
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining('RSS trace stopped'),
  );
  expect(io.closeSync).toHaveBeenCalledTimes(1);
  const writes = io.writeSync.mock.calls.length;
  trace.record('sample');
  trace.close();
  expect(io.writeSync).toHaveBeenCalledTimes(writes);
});

it('allows tests to continue when the trace file cannot be opened', () => {
  rstest.spyOn(logger, 'warn').mockImplementation(() => {});
  io.openSync.mockImplementationOnce(() => {
    throw new Error('read-only directory');
  });
  expect(createRssTrace('/workspace', true)).toBeUndefined();
});

it('disables diagnostics when memory sampling fails', () => {
  const warn = rstest.spyOn(logger, 'warn').mockImplementation(() => {});
  const trace = createRssTrace('/workspace', true)!;
  rstest.spyOn(process, 'memoryUsage').mockImplementationOnce(() => {
    throw new Error('sampling failed');
  });
  expect(() => trace.record('sample')).not.toThrow();
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('sampling failed'));
  const writes = io.writeSync.mock.calls.length;
  trace.record('sample');
  trace.close();
  expect(io.writeSync).toHaveBeenCalledTimes(writes);
  expect(io.closeSync).toHaveBeenCalledTimes(1);
});

it('does not enable diagnostics if the initial sample fails', () => {
  rstest.spyOn(logger, 'warn').mockImplementation(() => {});
  rstest.spyOn(process, 'memoryUsage').mockImplementationOnce(() => {
    throw new Error('sampling failed');
  });
  expect(createRssTrace('/workspace', true)).toBeUndefined();
  expect(io.closeSync).toHaveBeenCalledTimes(1);
});

it('contains close failures and closes only once', () => {
  rstest.spyOn(logger, 'warn').mockImplementation(() => {});
  const trace = createRssTrace('/workspace', true)!;
  io.closeSync.mockImplementationOnce(() => {
    throw new Error('close failed');
  });
  expect(() => trace.close()).not.toThrow();
  trace.close();
  expect(io.closeSync).toHaveBeenCalledTimes(1);
});

it('preserves the write error when closing also fails', () => {
  const warn = rstest.spyOn(logger, 'warn').mockImplementation(() => {});
  const trace = createRssTrace('/workspace', true)!;
  io.writeSync.mockImplementationOnce(() => {
    throw new Error('disk full');
  });
  io.closeSync.mockImplementationOnce(() => {
    throw new Error('close failed');
  });
  expect(() => trace.record('sample')).not.toThrow();
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('disk full'));
  trace.close();
  expect(io.closeSync).toHaveBeenCalledTimes(1);
});

it('preserves worker memory and leaves memory off worker exit records', () => {
  const trace = createRssTrace('/workspace', true)!;
  try {
    trace.record('worker:sample', {
      role: 'worker',
      pid: 123,
      rss: 1024,
      heapUsed: 512,
    });
    expect(JSON.parse(io.writeSync.mock.calls.at(-1)![1])).toMatchObject({
      event: 'worker:sample',
      role: 'worker',
      pid: 123,
      rss: 1024,
      heapUsed: 512,
    });
    trace.record('worker:exit', { role: 'worker', pid: 123 });
    const exit = JSON.parse(io.writeSync.mock.calls.at(-1)![1]);
    expect(exit).not.toHaveProperty('rss');
    expect(exit).not.toHaveProperty('heapUsed');
  } finally {
    trace.close();
  }
});
