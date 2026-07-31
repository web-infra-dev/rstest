import { expect, test } from '@rstest/core';
import { alsoCoveredDuringWorkerCleanup } from '../src/workerCleanup';

const cleanupTest = test.extend(
  'secondWorkerValue',
  { scope: 'worker' },
  (_context, { onCleanup }) => {
    onCleanup(() => {
      alsoCoveredDuringWorkerCleanup();
    });
    return 'second worker';
  },
);

cleanupTest(
  'runs before the second worker cleanup',
  ({ secondWorkerValue }) => {
    expect(secondWorkerValue).toBe('second worker');
  },
);
