import { expect, test } from '@rstest/core';
import { sharedMock } from './sharedMock';

// A NON-FIRST file: the shared-module mock (see sharedMock.ts) already
// accumulated calls in mockShareFirst. `clearMocks: true` clears the registry
// before each test, so a correctly-tracked shared mock must start at zero here.
test('mockShareSecond: clearMocks resets the shared-module mock across files', () => {
  // Guard: prove mockShareFirst ran first and left history, so the assertion
  // below can only pass because clearMocks reset the shared mock — not because
  // it was never called.
  expect((globalThis as Record<string, any>).__mockShareFirstCalls).toBe(2);
  expect(sharedMock.mock.calls.length).toBe(0);
});
