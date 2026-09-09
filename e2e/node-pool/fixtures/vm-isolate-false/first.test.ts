import { threadId } from 'node:worker_threads';
import { promisify } from 'node:util';
import { expect, it, rs } from '@rstest/core';
import { getCount, increment } from './shared';
import { workerTest } from './workerFixture';

const FILE_MARKER = '__RSTEST_VM_FILE_MARKER__';

it('supports awaiting runtime helpers without promising VM constructor identity', async () => {
  const value = { from: 'test VM' };
  const waiting = rs.waitFor(() => value);
  expect(waiting).not.toBeInstanceOf(Promise);
  expect(await waiting).toBe(value);

  const timeout = rs.waitUntil(() => false, { timeout: 1, interval: 1 });
  expect(timeout).not.toBeInstanceOf(Promise);
  await expect(timeout).rejects.toMatchObject({
    name: 'Error',
    message: 'waitUntil timed out in 1ms',
  });
  await timeout.catch((error) => expect(error).not.toBeInstanceOf(Error));

  const userError = new TypeError('user callback');
  await expect(
    rs.waitFor(
      () => {
        throw userError;
      },
      { timeout: 1, interval: 1 },
    ),
  ).rejects.toBe(userError);
  await expect(
    rs.waitUntil(() => {
      throw userError;
    }),
  ).rejects.toBe(userError);

  rs.useFakeTimers();
  try {
    let called = false;
    setTimeout(() => {
      called = true;
    }, 10);
    const running = rs.runAllTimersAsync();
    expect(running).not.toBeInstanceOf(Promise);
    await running;
    expect(called).toBe(true);
  } finally {
    rs.useRealTimers();
  }
});

it('preserves custom promisify for tracked immediate timers', async () => {
  await expect(promisify(setImmediate)('value')).resolves.toBe('value');
});

workerTest('isolates the first file', ({ workerValue }) => {
  const fileGlobal = globalThis as typeof globalThis & {
    __RSTEST_VM_SETUP_COUNT__?: number;
    [FILE_MARKER]?: string;
  };

  expect(workerValue).toBe('worker');
  expect(fileGlobal.__RSTEST_VM_SETUP_COUNT__).toBe(1);
  expect(fileGlobal[FILE_MARKER]).toBeUndefined();
  expect(getCount()).toBe(0);
  expect(
    (Promise as typeof Promise & { __RSTEST_VM_FILE__?: string })
      .__RSTEST_VM_FILE__,
  ).toBeUndefined();

  fileGlobal[FILE_MARKER] = 'first';
  (
    Promise as typeof Promise & { __RSTEST_VM_FILE__?: string }
  ).__RSTEST_VM_FILE__ = 'first';
  const RealmDate = Date;
  rs.setSystemTime(0);
  expect(Date).not.toBe(RealmDate);
  expect(new Date()).toBeInstanceOf(RealmDate);
  rs.useRealTimers();
  expect(Date).toBe(RealmDate);
  increment();
  expect(getCount()).toBe(1);
  console.log(`VM_THREAD_ID:${threadId}`);
});
