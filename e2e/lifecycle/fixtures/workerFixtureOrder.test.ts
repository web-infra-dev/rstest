import { expect, test } from '@rstest/core';

const scopedTest = test.extend(
  'workerValue',
  { scope: 'worker' },
  (_context, { onCleanup }) => {
    onCleanup(() => {
      process.stdout.write('[scope-order] worker cleanup\n');
    });
    return 'worker';
  },
);

scopedTest('uses a worker fixture', ({ workerValue }) => {
  expect(workerValue).toBe('worker');
});
