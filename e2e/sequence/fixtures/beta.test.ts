import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, describe, expect, rs, test } from '@rstest/core';
import { bigPayloadSize } from './bigHelper';

if (process.env.SEQ_SLOW_IMPORT === '1') {
  rs.useFakeTimers();
  rs.setSystemTime(0);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);
  rs.useRealTimers();
}

if (process.env.SEQ_IMPORT_FAIL === '1') {
  throw new Error('intentional module loading failure');
}

// Imports a large helper, so its emitted bundle is by far the biggest entry.
// On a cold cache this pushes it to the front (size-desc ordering) even though
// 'beta' sorts after 'alpha' alphabetically.
test('beta', () => {
  console.log('SEQ:beta');
  expect(bigPayloadSize).toBeGreaterThan(0);
});

if (process.env.SEQ_CLEANUP_TIMEOUT === '1') {
  const cleanupTest = test.extend(
    'cleanup',
    { scope: 'file' },
    (_context, { onCleanup }) => {
      onCleanup(() => new Promise<never>(() => {}));
      return true;
    },
  );
  cleanupTest('file fixture hangs during cleanup', ({ cleanup }) => {
    expect(cleanup).toBe(true);
  });
}

if (process.env.SEQ_SLOW_COLLECT === '1') {
  describe('deferred collection', async () => {
    console.log('COLLECT:beta');
    await delay(600);
    describe('nested collection', () => {
      rs.useFakeTimers();
      rs.setSystemTime(0);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 600);
      rs.useRealTimers();
      if (process.env.SEQ_COLLECT_FAIL === '1') {
        throw new Error('intentional suite collection failure');
      }
      test('collected once', () => {
        expect(true).toBe(true);
      });
    });
  });
}

if (process.env.SEQ_FAKE_NEXT_TICK === '1') {
  describe('fake nextTick during collection', () => {
    rs.useFakeTimers({ toFake: ['nextTick'] });
    afterAll(() => {
      rs.useRealTimers();
    });
    test('collects and runs', () => {
      expect(true).toBe(true);
    });
  });
}
