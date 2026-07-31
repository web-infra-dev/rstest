import { expect, test } from '@rstest/core';

const cleanupTest = test.extend(
  'workerResource',
  { scope: 'worker' },
  (_context, { onCleanup }) => {
    onCleanup(() => new Promise<void>(() => {}));
    return 'ready';
  },
);

cleanupTest('does not hang on worker cleanup', ({ workerResource }) => {
  expect(workerResource).toBe('ready');
});
