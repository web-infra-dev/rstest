import { expect, test } from '@rstest/core';
import {
  installObjectURLTracker,
  installTimerTracking,
  type NodeTimerPrimitives,
} from '../../../../src/runtime/worker/env/utils';

test('should not record timers for a worker-scoped environment', () => {
  const cleared: unknown[] = [];
  const nodeTimers = {
    setTimeout: () => ({}) as NodeJS.Timeout,
    setInterval: () => ({}) as NodeJS.Timeout,
    clearTimeout: (timer: unknown) => cleared.push(timer),
    clearInterval: (timer: unknown) => cleared.push(timer),
  } as unknown as NodeTimerPrimitives;
  const testGlobal = {} as typeof globalThis;

  const cleanup = installTimerTracking(testGlobal, nodeTimers, {
    scope: 'worker',
  });
  testGlobal.setTimeout(() => {}, 1000);
  testGlobal.setInterval(() => {}, 1000);
  cleanup();

  // Nothing to clear proves nothing was recorded — the worker-scoped
  // environment must not retain timers it will never tear down (#1644).
  expect(cleared).toEqual([]);
});

test('should revoke remaining object URLs and restore methods', () => {
  const revoked: string[] = [];
  let nextId = 0;
  class TestURL extends URL {
    static override createObjectURL(_object: Blob | MediaSource): string {
      return `blob:test:${nextId++}`;
    }

    static override revokeObjectURL(url: string): void {
      revoked.push(url);
    }
  }

  const originalCreateObjectURL = TestURL.createObjectURL;
  const originalRevokeObjectURL = TestURL.revokeObjectURL;
  const cleanup = installObjectURLTracker(TestURL, { scope: 'file' });
  const revokedByUser = TestURL.createObjectURL(new Blob());
  const revokedByCleanup = TestURL.createObjectURL(new Blob());

  TestURL.revokeObjectURL(revokedByUser);
  cleanup();

  expect(revoked).toEqual([revokedByUser, revokedByCleanup]);
  expect(TestURL.createObjectURL).toBe(originalCreateObjectURL);
  expect(TestURL.revokeObjectURL).toBe(originalRevokeObjectURL);
});
