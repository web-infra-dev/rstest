import { expect, test } from '@rstest/core';

const cleanupTest = test.extend(
  'workerValue',
  { scope: 'worker' },
  (_context, { onCleanup }) => {
    onCleanup(() => {
      throw new Error('browser worker cleanup after fatal reached');
    });
    return 'worker';
  },
);

cleanupTest(
  'fails after the worker fixture is initialized',
  ({ workerValue }) => {
    expect(workerValue).toBe('worker');
    Object.defineProperty(globalThis, '__coverage__', {
      configurable: true,
      get() {
        throw new Error('browser fatal after worker fixture setup');
      },
    });
  },
);
