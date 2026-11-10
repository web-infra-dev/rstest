import { expect, test } from '@rstest/core';

test('pending timers are scoped to the DOM environment', () => {
  const timeout = setTimeout(() => {}, 60_000);
  const interval = setInterval(() => {}, 60_000);

  expect(typeof timeout.ref).toBe('function');
  expect(typeof interval.ref).toBe('function');
});
