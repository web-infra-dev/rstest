import { expect, test } from '@rstest/core';

// Small, fast entry. Fails only when SEQ_FAIL=1 so the failed-first ordering
// can be exercised (see index.test.ts).
test('alpha', () => {
  console.log('SEQ:alpha');
  if (process.env.SEQ_FAIL === '1') {
    throw new Error('intentional failure for sequencing e2e');
  }
  expect(1 + 1).toBe(2);
});
