import { expect, test } from '@rstest/core';

test('a failing test must not downgrade the pre-set exit code', () => {
  expect(1).toBe(2);
});
