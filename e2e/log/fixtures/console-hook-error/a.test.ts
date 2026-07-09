import { expect, test } from '@rstest/core';

test('passes even though the onConsoleLog hook throws', () => {
  console.log('hello from a');
  expect(1).toBe(1);
});
