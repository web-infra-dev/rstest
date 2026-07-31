import { expect, test } from '@rstest/core';
import { cleanupOnly } from '../src/cleanupOnly';

const cleanupTest = test.extend(
  'workerValue',
  { scope: 'worker' },
  (_context, { onCleanup }) => {
    onCleanup(() => {
      cleanupOnly();
    });
    return 'worker';
  },
);

cleanupTest('collects worker cleanup coverage', ({ workerValue }) => {
  expect(workerValue).toBe('worker');
});
