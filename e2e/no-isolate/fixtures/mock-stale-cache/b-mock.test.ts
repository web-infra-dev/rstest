import { expect, rstest, test } from '@rstest/core';
import { getValue } from './consumer';
import { singleton } from './singleton';

// If a-warmup runs first, consumer is already cached with the REAL dep
// closure; the mock must still take effect through consumer.
rstest.mock('./dep', () => ({ value: () => 'MOCKED' }));

test('b-mock: mock of dep takes effect through consumer', () => {
  expect(getValue()).toBe('MOCKED');
});

// The fresh module world for this mocking file must be established BEFORE the
// setup file loads — otherwise setup would hold one singleton instance and
// this test another.
test('b-mock: setup and test share the same module instance', () => {
  expect(singleton).toBe(
    (globalThis as Record<string, unknown>).__setupSingleton,
  );
});
