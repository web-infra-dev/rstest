import { expect, test } from '@rstest/core';

const cleanupFailureTest = test.extend(
  'workerValue',
  { scope: 'worker' },
  (_context, { onCleanup }) => {
    onCleanup(() => {
      throw new Error('reporter worker cleanup failed');
    });
    return 'worker';
  },
);

cleanupFailureTest('reports cleanup failure', ({ workerValue }) => {
  expect(workerValue).toBe('worker');
});
