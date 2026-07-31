import { expect, test } from '@rstest/core';

const cleanupTest = test.extend(
  'workerValue',
  { scope: 'worker' },
  (_context, { onCleanup }) => {
    onCleanup(() => {
      void Promise.reject(
        new Error('unhandled worker fixture cleanup rejection'),
      );
    });
    return 'worker';
  },
);

cleanupTest('runs before worker cleanup', ({ workerValue }) => {
  expect(workerValue).toBe('worker');
});
