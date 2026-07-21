import { expect, test } from '@rstest/core';

test('should run when include is added by modifyRstestConfig after initial empty entries', () => {
  expect(1 + 1).toBe(2);
});
