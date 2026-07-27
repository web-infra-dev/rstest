import { expect, test } from '@rstest/core';

// Always passes, so `--onlyFailures` should deselect it after `first` fails.
test('third', () => {
  console.log('RUN:third');
  expect(3 + 3).toBe(6);
});
