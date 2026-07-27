import { expect, test } from '@rstest/core';
import { sharedMock } from './sharedMock';

// Peer of mockShareA — identical body, no assumed order. See mockShareA for the
// full rationale: the file that happens to run second is the one that proves
// `clearMocks` resets the shared-module mock across the file boundary.
test('mockShareB: shared-module mock is cleared before each test, across files', () => {
  expect(sharedMock.mock.calls.length).toBe(0);
  sharedMock(1);
  sharedMock(2);
  expect(sharedMock.mock.calls.length).toBe(2);
});
