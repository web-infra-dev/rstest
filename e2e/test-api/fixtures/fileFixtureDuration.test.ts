import { expect, test } from '@rstest/core';

const fileTest = test.extend(
  'resource',
  { scope: 'file' },
  (_context, { onCleanup }) => {
    onCleanup(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 120);
        }),
    );
    return 'ready';
  },
);

fileTest('uses the resource', ({ resource }) => {
  expect(resource).toBe('ready');
});
