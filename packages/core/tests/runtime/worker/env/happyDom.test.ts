import { setTimeout as nodeSetTimeout } from 'node:timers';
import { describe, expect, it } from '@rstest/core';
import { environment } from '../../../../src/runtime/worker/env/happyDom';

const createTestGlobal = (): typeof globalThis =>
  ({
    clearInterval: globalThis.clearInterval,
    clearTimeout: globalThis.clearTimeout,
    console: globalThis.console,
    fetch: globalThis.fetch,
    setInterval: globalThis.setInterval,
    setTimeout: globalThis.setTimeout,
  }) as unknown as typeof globalThis;

describe('happy-dom environment', () => {
  it('cancels active intervals during teardown', async () => {
    const testGlobal = createTestGlobal();
    const nativeClearInterval = testGlobal.clearInterval;
    testGlobal.clearInterval = rs.fn((timer) => nativeClearInterval(timer));
    const nodeTimers = {
      clearInterval: testGlobal.clearInterval,
      clearTimeout: testGlobal.clearTimeout,
      setInterval: testGlobal.setInterval,
      setTimeout: testGlobal.setTimeout,
    };
    const { teardown } = await environment.setup(testGlobal, {});
    let calls = 0;
    let tornDown = false;

    try {
      const timeout = testGlobal.setTimeout(() => {}, 1_000);
      expect(typeof timeout).toBe('object');
      expect(timeout.unref).toBeTypeOf('function');
      testGlobal.clearTimeout(timeout);

      const interval = testGlobal.setInterval(() => {
        calls++;
      }, 1);

      tornDown = true;
      await teardown();
      expect(nodeTimers.clearInterval).toHaveBeenCalledWith(interval);
      await new Promise((resolve) => nodeSetTimeout(resolve, 20));

      expect(calls).toBe(0);
      expect(testGlobal.setTimeout).toBe(nodeTimers.setTimeout);
      expect(testGlobal.clearTimeout).toBe(nodeTimers.clearTimeout);
      expect(testGlobal.setInterval).toBe(nodeTimers.setInterval);
      expect(testGlobal.clearInterval).toBe(nodeTimers.clearInterval);
    } finally {
      if (!tornDown) {
        await teardown();
      }
    }
  });
});
