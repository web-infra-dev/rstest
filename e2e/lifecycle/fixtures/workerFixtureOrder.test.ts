import { expect, test } from '@rstest/core';

const scopedTest = test.extend(
  'workerValue',
  { scope: 'worker' },
  (_context, { onCleanup }) => {
    onCleanup(() => {
      console.log('[scope-order] worker cleanup');
    });
    return 'worker';
  },
);

scopedTest('uses a worker fixture', ({ workerValue }) => {
  expect(workerValue).toBe('worker');
});
