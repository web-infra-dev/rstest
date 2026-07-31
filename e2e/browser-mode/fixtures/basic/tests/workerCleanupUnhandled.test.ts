import { expect, test } from '@rstest/core';

const cleanupTest = test.extend(
  'workerValue',
  { scope: 'worker' },
  (_context, { onCleanup }) => {
    onCleanup(() => {
      void Promise.reject(
        new Error('unhandled browser worker cleanup rejection'),
      );
    });
    return 'worker';
  },
);

cleanupTest('captures errors after cleanup returns', ({ workerValue }) => {
  expect(workerValue).toBe('worker');
});
