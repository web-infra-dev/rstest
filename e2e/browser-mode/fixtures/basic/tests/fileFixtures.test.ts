import { afterAll, expect, test } from '@rstest/core';

let setupCount = 0;

const browserTest = test.extend(
  'fileValue',
  { scope: 'file' },
  (_context, { onCleanup }) => {
    setupCount++;
    onCleanup(() => {
      console.log('RSTEST_BROWSER_FILE_FIXTURE_CLEANUP_OK');
    });
    return { setupCount };
  },
);

browserTest.concurrent(
  'shares with the first browser test',
  ({ fileValue }) => {
    expect(fileValue.setupCount).toBe(1);
  },
);

browserTest.concurrent(
  'shares with the second browser test',
  ({ fileValue }) => {
    expect(fileValue.setupCount).toBe(1);
  },
);

afterAll(() => {
  expect(setupCount).toBe(1);
});
