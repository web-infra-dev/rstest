import { test } from '@rstest/core';

let setupCount = 0;

export const workerTest = test.extend(
  'browserWorkerValue',
  { scope: 'worker' },
  (_context, { onCleanup }) => {
    setupCount++;
    console.log(`RSTEST_BROWSER_WORKER_SETUP_${setupCount}`);
    onCleanup(() => {
      console.log(`RSTEST_BROWSER_WORKER_CLEANUP_${setupCount}`);
    });
    return 'worker';
  },
);
