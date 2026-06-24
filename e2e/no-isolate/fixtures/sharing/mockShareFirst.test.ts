import { expect, test } from '@rstest/core';
import { sharedMock } from './sharedMock';

// Runs BEFORE mockShareSecond (alphabetical order, single worker). Leaves call
// history on the shared-module mock so the next file can prove `clearMocks`
// reset it across the file boundary.
test('mockShareFirst: shared-module mock records calls', () => {
  sharedMock(1);
  sharedMock(2);
  expect(sharedMock.mock.calls.length).toBe(2);
  (globalThis as Record<string, any>).__mockShareFirstCalls =
    sharedMock.mock.calls.length;
});
