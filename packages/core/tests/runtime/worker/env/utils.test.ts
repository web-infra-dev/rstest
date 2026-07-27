import { expect, test } from '@rstest/core';
import { installObjectURLTracker } from '../../../../src/runtime/worker/env/utils';

test('should revoke remaining object URLs and restore methods', () => {
  const revoked: string[] = [];
  let nextId = 0;
  class TestURL extends URL {
    static override createObjectURL(): string {
      return `blob:test:${nextId++}`;
    }

    static override revokeObjectURL(url: string): void {
      revoked.push(url);
    }
  }

  const originalCreateObjectURL = TestURL.createObjectURL;
  const originalRevokeObjectURL = TestURL.revokeObjectURL;
  const cleanup = installObjectURLTracker(TestURL);
  const revokedByUser = TestURL.createObjectURL(new Blob());
  const revokedByCleanup = TestURL.createObjectURL(new Blob());

  TestURL.revokeObjectURL(revokedByUser);
  cleanup();

  expect(revoked).toEqual([revokedByUser, revokedByCleanup]);
  expect(TestURL.createObjectURL).toBe(originalCreateObjectURL);
  expect(TestURL.revokeObjectURL).toBe(originalRevokeObjectURL);
});
