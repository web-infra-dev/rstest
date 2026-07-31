import { expect, test } from '@rstest/core';

const cleanupTest = test.extend(
  'fileValue',
  { scope: 'file' },
  (_context, { onCleanup }) => {
    onCleanup(() => new Promise<void>(() => {}));
    return 'file';
  },
);

cleanupTest('runs before file cleanup', ({ fileValue }) => {
  expect(fileValue).toBe('file');
});
