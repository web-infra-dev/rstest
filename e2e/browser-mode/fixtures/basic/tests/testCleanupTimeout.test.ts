import { expect, test } from '@rstest/core';

const cleanupTest = test.extend('testValue', (_context, { onCleanup }) => {
  onCleanup(() => new Promise<void>(() => {}));
  return 'test';
});

cleanupTest(
  'bounds browser test fixture cleanup',
  ({ testValue }) => {
    expect(testValue).toBe('test');
  },
  100,
);
