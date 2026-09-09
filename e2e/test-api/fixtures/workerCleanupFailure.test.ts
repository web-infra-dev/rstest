import { expect, test } from '@rstest/core';

const workerTest = test.extend(
  'workerValue',
  { scope: 'worker' },
  (_context, { onCleanup }) => {
    onCleanup(() => {
      throw new Error('worker fixture cleanup reached');
    });
    return 'worker';
  },
);

workerTest('uses the worker fixture', ({ workerValue }) => {
  expect(workerValue).toBe('worker');
});
