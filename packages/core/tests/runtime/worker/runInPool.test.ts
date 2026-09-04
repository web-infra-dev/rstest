import { expect, test } from '@rstest/core';
import { isBlockedProcessKillTarget } from '../../../src/runtime/worker/runInPool';

test('blocks process-group and current-process kill targets', () => {
  expect(isBlockedProcessKillTarget(0, 123)).toBe(true);
  expect(isBlockedProcessKillTarget(-1, 123)).toBe(true);
  expect(isBlockedProcessKillTarget(123, 123)).toBe(true);
  expect(isBlockedProcessKillTarget(-123, 123)).toBe(true);
  expect(isBlockedProcessKillTarget(456, 123)).toBe(false);
});
