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
