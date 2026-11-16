import { expect, test } from '@rstest/core';

const workerTest = test.extend(
  'session',
  { scope: 'worker' },
  (_context, { onCleanup }) => {
    onCleanup(() => {
      const error = new Error('Failed to end the session', {
        cause: new TypeError('session already ended'),
      });
      // A stack that is not text must not reach the reporter.
      Object.defineProperty(error, 'stack', { value: ['remote frame'] });
      throw error;
    });
    return 'active';
  },
);

workerTest('uses a worker fixture', ({ session }) => {
  expect(session).toBe('active');
});
