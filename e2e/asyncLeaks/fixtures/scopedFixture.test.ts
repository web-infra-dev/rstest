import { expect, test } from '@rstest/core';

const workerTest = test.extend(
  'workerTimer',
  { scope: 'worker' },
  (_context, { onCleanup }) => {
    const timer = setInterval(() => undefined, 1_000);
    onCleanup(() => clearInterval(timer));
    return timer;
  },
);

workerTest(
  'does not report worker fixture resources as test leaks',
  ({ workerTimer }) => {
    expect(workerTimer).toBeDefined();
  },
);
