import { expect, test } from '@rstest/core';

const cleanupTest = test.extend(
  'workerValue',
  { scope: 'worker' },
  (_context, { onCleanup }) => {
    onCleanup(() => {
      console.log('worker cleanup owner A log');
      throw new Error('worker cleanup owner A failure');
    });
    return 'worker';
  },
);

cleanupTest('creates the worker fixture in project A', ({ workerValue }) => {
  expect(workerValue).toBe('worker');
});
