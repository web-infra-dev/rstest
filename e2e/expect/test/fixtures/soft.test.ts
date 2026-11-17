import { expect, test } from '@rstest/core';

test('expect.soft test', () => {
  expect.soft(1 + 1).toBe(3); // should mark the test as fail and continue
  expect.soft(1 + 2).toBe(4); // should mark the test as fail and continue
  expect.soft(1 + 3).toBe(4);
});

let attempts = 0;
test('expect.soft retry can recover', { retry: 1 }, () => {
  attempts += 1;
  expect.soft(attempts).toBe(2);
});

let failedAttempts = 0;
test('expect.soft preserves failed retry errors', { retry: 1 }, () => {
  failedAttempts += 1;
  expect.soft(failedAttempts).toBe(100);
});

test('expect.soft failures are kept when the test throws', () => {
  expect.soft(5).toBe(50);
  throw new Error('THROWN_AFTER_SOFT');
});

test('expect.soft failures are kept when a later expect fails', () => {
  expect.soft(6).toBe(60);
  expect(7).toBe(70);
});
