import { expect, test } from '@rstest/core';

test('runs after another file fixture cleanup times out', () => {
  console.log('RSTEST_NODE_CONTINUED_AFTER_FILE_CLEANUP_TIMEOUT');
  expect(true).toBe(true);
});
