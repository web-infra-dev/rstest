import { expect, test } from '@rstest/core';

test('preserves the run verdict', () => {
  expect(process.env.FAIL_TEST).not.toBe('true');
});
