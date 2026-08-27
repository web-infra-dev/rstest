import { test } from '@rstest/core';

export const workerTest = test.extend(
  'workerValue',
  { scope: 'worker' },
  (_context, { onCleanup }) => {
    console.log('VM_WORKER_FIXTURE_SETUP');
    onCleanup(() => console.log('VM_WORKER_FIXTURE_CLEANUP'));
    return 'worker';
  },
);
