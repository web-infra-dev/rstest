import { expect, test } from '@rstest/core';
import { marker } from './shared';

const workerTest = test.extend(
  'workerMarker',
  { scope: 'worker' },
  (_context, { onCleanup }) => {
    console.log(`WORKER_FIXTURE_SETUP=${marker}`);
    onCleanup(() => {
      console.log(`WORKER_FIXTURE_CLEANUP=${marker}`);
    });
    return marker;
  },
);

workerTest('surfaces the current shared module value', ({ workerMarker }) => {
  // Printed to stdout (console interception disabled) so the e2e can assert the
  // rerun observed the rebuilt value.
  console.log(`SHARED_MARKER=${marker}`);
  expect(workerMarker).toBe(marker);
});
