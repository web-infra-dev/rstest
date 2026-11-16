import { expect, test } from '@rstest/core';

const workerTest = test.extend(
  'connection',
  { scope: 'worker' },
  (_context, { onCleanup }) => {
    onCleanup(() => {
      throw new Error('Failed to close the connection', {
        cause: new TypeError('socket already closed'),
      });
    });
    return 'open';
  },
);

workerTest('uses a worker fixture', ({ connection }) => {
  expect(connection).toBe('open');
});
