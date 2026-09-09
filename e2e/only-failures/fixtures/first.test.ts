import { expect, test } from '@rstest/core';

// Small, fast entry. Fails only when FAIL_FIRST=1 so the previous-run failure
// state can be driven deterministically (see index.test.ts).
test('first', () => {
  console.log('RUN:first');
  if (process.env.FAIL_FIRST === '1') {
    throw new Error('intentional failure for onlyFailures e2e');
  }
  expect(1 + 1).toBe(2);
});
