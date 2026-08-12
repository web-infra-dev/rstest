import { afterAll, expect, test } from '@rstest/core';

let setupCount = 0;

const browserTest = test
  .extend('workerValue', { scope: 'worker' }, (_context, { onCleanup }) => {
    onCleanup(() => {
      console.log('RSTEST_BROWSER_WORKER_FIXTURE_CLEANUP_OK');
    });
    return 'worker';
  })
  .extend('fileValue', { scope: 'file' }, ({ workerValue }, { onCleanup }) => {
    setupCount++;
    onCleanup(() => {
      console.log('RSTEST_BROWSER_FILE_FIXTURE_CLEANUP_OK');
    });
    return { setupCount, workerValue };
  });

browserTest.concurrent(
  'shares with the first browser test',
  ({ fileValue }) => {
    expect(fileValue.setupCount).toBe(1);
    expect(fileValue.workerValue).toBe('worker');
  },
);

browserTest.concurrent(
  'shares with the second browser test',
  ({ fileValue }) => {
    expect(fileValue.setupCount).toBe(1);
    expect(fileValue.workerValue).toBe('worker');
  },
);

afterAll(() => {
  expect(setupCount).toBe(1);
});
