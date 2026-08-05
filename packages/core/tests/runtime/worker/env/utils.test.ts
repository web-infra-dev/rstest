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

const createTestURL = () => {
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
  return { TestURL, revoked };
};

test('should revoke remaining object URLs and restore methods', () => {
  const { TestURL, revoked } = createTestURL();
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

test('should not track object URLs for a worker-scoped environment', () => {
  const { TestURL, revoked } = createTestURL();
  const originalCreateObjectURL = TestURL.createObjectURL;

  const cleanup = installObjectURLTracker(TestURL, { scope: 'worker' });
  TestURL.createObjectURL(new Blob());
  cleanup();

  // The methods are left unwrapped, so there is nothing to revoke — the
  // worker-scoped environment must not retain what it never tears down
  // (#1644).
  expect(TestURL.createObjectURL).toBe(originalCreateObjectURL);
  expect(revoked).toEqual([]);
});
