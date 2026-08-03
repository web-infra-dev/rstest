import { expect, test } from '@rstest/core';

const cleanupTest = test.extend(
  'workerValue',
  { scope: 'worker' },
  (_context, { onCleanup }) => {
    onCleanup(() => new Promise<void>(() => {}));
    return 'worker';
  },
);

cleanupTest('runs before worker cleanup', ({ workerValue }) => {
  expect(workerValue).toBe('worker');
});
