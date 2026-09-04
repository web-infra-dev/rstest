import { appendFileSync } from 'node:fs';
import { setTimeout as setTimeoutPromise } from 'node:timers/promises';
import { threadId } from 'node:worker_threads';
import { expect, it } from '@rstest/core';
import { getCount, increment } from './shared';
import { workerTest } from './workerFixture';

const FILE_MARKER = '__RSTEST_VM_FILE_MARKER__';

workerTest('isolates the second file', ({ workerValue }) => {
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

  fileGlobal[FILE_MARKER] = 'second';
  (
    Promise as typeof Promise & { __RSTEST_VM_FILE__?: string }
  ).__RSTEST_VM_FILE__ = 'second';
  increment();
  expect(getCount()).toBe(1);
  console.log(`VM_THREAD_ID:${threadId}`);
});

it('runs after the previous VM context has been disposed', async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));
});

it('re-homes host fetch errors into the VM realm', async () => {
  await expect(fetch('not a url')).rejects.toThrow(TypeError);
});

it('keeps process guards active during VM cleanup', () => {
  const marker = process.env.RSTEST_VM_GUARD_MARKER;
  if (!marker) {
    throw new Error('RSTEST_VM_GUARD_MARKER is required');
  }

  void setTimeoutPromise(60_000).catch(() => {
    try {
      process.kill(process.pid, 'SIGCONT');
      appendFileSync(marker, 'unguarded\n');
    } catch {
      appendFileSync(marker, 'guarded\n');
    }
  });
});
