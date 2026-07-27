import { expect, test } from '@rstest/core';

// Always passes, so `--onlyFailures` should deselect it after `first` fails.
test('second', () => {
  console.log('RUN:second');
  expect(2 + 2).toBe(4);
});
