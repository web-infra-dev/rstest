import { appendFileSync } from 'node:fs';
import { test } from '@rstest/core';

const cleanupMarker = process.env.RSTEST_VM_CLEANUP_MARKER;
if (!cleanupMarker) {
  throw new Error('RSTEST_VM_CLEANUP_MARKER is required');
}

export const workerTest = test.extend(
  'workerValue',
  { scope: 'worker' },
  (_context, { onCleanup }) => {
    console.log('VM_WORKER_FIXTURE_SETUP');
    onCleanup(() => {
      appendFileSync(cleanupMarker, 'cleanup\n');
      console.log('VM_WORKER_FIXTURE_CLEANUP');
    });
    return 'worker';
  },
);
