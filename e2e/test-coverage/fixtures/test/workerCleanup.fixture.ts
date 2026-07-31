import { expect, test } from '@rstest/core';
import { coveredOnlyDuringWorkerCleanup } from '../src/workerCleanup';

const cleanupTest = test.extend(
  'workerValue',
  { scope: 'worker' },
  (_context, { onCleanup }) => {
    onCleanup(() => {
      coveredOnlyDuringWorkerCleanup();
    });
    return 'worker';
  },
);

cleanupTest('runs before worker cleanup', ({ workerValue }) => {
  expect(workerValue).toBe('worker');
});
