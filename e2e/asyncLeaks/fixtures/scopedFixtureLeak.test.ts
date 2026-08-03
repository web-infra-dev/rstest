import { expect, test } from '@rstest/core';

const workerTest = test.extend('workerTimer', { scope: 'worker' }, () =>
  setInterval(() => undefined, 1_000),
);

workerTest(
  'reports worker fixture resources without cleanup',
  ({ workerTimer }) => {
    expect(workerTimer).toBeDefined();
  },
);
