import { threadId } from 'node:worker_threads';
import { expect } from '@rstest/core';
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

  fileGlobal[FILE_MARKER] = 'second';
  increment();
  expect(getCount()).toBe(1);
  console.log(`VM_THREAD_ID:${threadId}`);
});
