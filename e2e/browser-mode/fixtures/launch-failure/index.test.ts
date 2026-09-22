import { expect, test } from '@rstest/core';

test('must not run without a browser', () => {
  expect.unreachable('The browser launch should fail');
});
