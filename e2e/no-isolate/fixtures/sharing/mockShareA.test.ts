import { expect, test } from '@rstest/core';
import { sharedMock } from './sharedMock';

// Peer of mockShareB (no assumed order). The mock lives in a module SHARED
// across files, so under `isolate: false` it persists between them. `clearMocks:
// true` must therefore reset it before every test in every file — even though
// the per-file registry reset no longer clears the (weakly-held) kept mock.
// Whichever of these two files runs second proves the reset crosses the file
// boundary: the first file leaves call history, yet the assertion below still
// sees zero. A registry that dropped the kept mock without re-registering it
// would leak that history and fail here.
// See https://github.com/web-infra-dev/rstest/pull/1376#discussion_r3457255132.
test('mockShareA: shared-module mock is cleared before each test, across files', () => {
  expect(sharedMock.mock.calls.length).toBe(0);
  sharedMock(1);
  sharedMock(2);
  expect(sharedMock.mock.calls.length).toBe(2);
});
