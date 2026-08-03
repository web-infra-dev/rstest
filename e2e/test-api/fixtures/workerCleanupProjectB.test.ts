import { expect, test } from '@rstest/core';

const cleanupTest = test.extend(
  'workerValue',
  { scope: 'worker' },
  (_context, { onCleanup }) => {
    onCleanup(() => {
      console.log('worker cleanup owner B log');
      throw new Error('worker cleanup owner B failure');
    });
    return 'worker';
  },
);

cleanupTest('creates the worker fixture in project B', ({ workerValue }) => {
  expect(workerValue).toBe('worker');
});
