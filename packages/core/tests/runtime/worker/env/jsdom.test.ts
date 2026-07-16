import { setTimeout as nodeSetTimeout } from 'node:timers';
import { promisify } from 'node:util';
import { describe, expect, it } from '@rstest/core';
import type { DOMWindow } from 'jsdom';
import { environment } from '../../../../src/runtime/worker/env/jsdom';

const createTestGlobal = (): typeof globalThis =>
  ({
    clearInterval: globalThis.clearInterval,
    clearTimeout: globalThis.clearTimeout,
    console: globalThis.console,
    fetch: globalThis.fetch,
    setInterval: globalThis.setInterval,
    setTimeout: globalThis.setTimeout,
  }) as unknown as typeof globalThis;

describe('jsdom environment', () => {
  it('tracks Node timers and clears them during teardown', async () => {
    const testGlobal = createTestGlobal();
    const nodeTimers = {
      clearInterval: testGlobal.clearInterval,
      clearTimeout: testGlobal.clearTimeout,
      setInterval: testGlobal.setInterval,
      setTimeout: testGlobal.setTimeout,
    };
    const nodeFetch = testGlobal.fetch;
    const { teardown } = await environment.setup(testGlobal, {});
    let tornDown = false;

    try {
      expect(testGlobal.setTimeout).toBe(testGlobal.window.setTimeout);
      expect(testGlobal.setTimeout).not.toBe(nodeTimers.setTimeout);
      expect(testGlobal.setInterval).not.toBe(nodeTimers.setInterval);
      expect(testGlobal.fetch).toBe(nodeFetch);

      const timeout = testGlobal.setTimeout(() => {}, 1_000);
      expect(typeof timeout).toBe('object');
      expect(timeout.unref).toBeTypeOf('function');
      testGlobal.clearTimeout(timeout);

      let intervalCalls = 0;
      let resolveFirstInterval = () => {};
      const firstInterval = new Promise<void>((resolve) => {
        resolveFirstInterval = resolve;
      });
      const interval = testGlobal.setInterval(() => {
        intervalCalls++;
        resolveFirstInterval();
      }, 1);
      expect(typeof interval).toBe('object');
      await firstInterval;
      const callsBeforeTeardown = intervalCalls;

      tornDown = true;
      await teardown();
      await new Promise((resolve) => nodeSetTimeout(resolve, 20));

      expect(intervalCalls).toBe(callsBeforeTeardown);
      expect(testGlobal.setTimeout).toBe(nodeTimers.setTimeout);
      expect(testGlobal.clearTimeout).toBe(nodeTimers.clearTimeout);
      expect(testGlobal.setInterval).toBe(nodeTimers.setInterval);
      expect(testGlobal.clearInterval).toBe(nodeTimers.clearInterval);
      expect(testGlobal.fetch).toBe(nodeFetch);
    } finally {
      if (!tornDown) {
        await teardown();
      }
    }
  });

  it('keeps native jsdom timer realm and close semantics', async () => {
    const testGlobal = createTestGlobal();
    let retainedWindow: DOMWindow | undefined;
    let beforeParseTimerType: string | undefined;
    const { teardown } = await environment.setup(testGlobal, {
      html: `<!DOCTYPE html><body><script>
        var timerToken = 'ok';
        setTimeout(function () {
          document.body.dataset.timerThis = String(this === window);
        }, 0);
        setTimeout("document.body.dataset.timerToken = timerToken", 0);
      </script></body>`,
      beforeParse(window) {
        retainedWindow = window;
        const timer = window.setTimeout(() => {}, 0);
        beforeParseTimerType = typeof timer;
        window.clearTimeout(timer);
      },
    });
    let tornDown = false;

    try {
      await new Promise((resolve) => nodeSetTimeout(resolve, 20));
      expect(beforeParseTimerType).toBe('number');
      expect(testGlobal.document.body.dataset.timerThis).toBe('true');
      expect(testGlobal.document.body.dataset.timerToken).toBe('ok');

      tornDown = true;
      await teardown();
      if (!retainedWindow) {
        throw new Error('Expected beforeParse to receive the jsdom window');
      }

      let called = false;
      const timer = retainedWindow.setTimeout(() => {
        called = true;
      }, 0);
      await new Promise((resolve) => nodeSetTimeout(resolve, 20));

      expect(timer).toBe(0);
      expect(called).toBe(false);
    } finally {
      if (!tornDown) {
        await teardown();
      }
    }
  });

  it('routes timer callback errors through the jsdom window', async () => {
    const testGlobal = createTestGlobal();
    const { teardown } = await environment.setup(testGlobal, {});
    const expected = new Error('timer error');

    try {
      const received = new Promise<unknown>((resolve) => {
        testGlobal.addEventListener(
          'error',
          (event) => {
            event.preventDefault();
            resolve(event.error);
          },
          { once: true },
        );
      });
      testGlobal.setTimeout(() => {
        throw expected;
      }, 0);

      expect(await received).toBe(expected);
    } finally {
      await teardown();
    }
  });

  it('clears a timeout refreshed from inside its callback', async () => {
    const testGlobal = createTestGlobal();
    const { teardown } = await environment.setup(testGlobal, {});
    let calls = 0;
    let tornDown = false;

    try {
      await new Promise<void>((resolve) => {
        testGlobal.setTimeout(function (this: NodeJS.Timeout) {
          calls++;
          if (calls === 1) {
            this.refresh();
            resolve();
          }
        }, 10);
      });

      tornDown = true;
      await teardown();
      await new Promise((resolve) => nodeSetTimeout(resolve, 30));
      expect(calls).toBe(1);
    } finally {
      if (!tornDown) {
        await teardown();
      }
    }
  });

  it('preserves Node setTimeout utility behavior', async () => {
    const testGlobal = createTestGlobal();
    const { teardown } = await environment.setup(testGlobal, {});

    try {
      const sleep = promisify(testGlobal.setTimeout);
      await expect(sleep(1, 'done')).resolves.toBe('done');

      let errorCode: string | undefined;
      try {
        Reflect.apply(testGlobal.setTimeout, testGlobal, ['invalid', 0]);
      } catch (error) {
        errorCode = (error as { code?: string }).code;
      }
      expect(errorCode).toBe('ERR_INVALID_ARG_TYPE');
    } finally {
      await teardown();
    }
  });

  it('releases completed one-shot timeouts from teardown tracking', async () => {
    const testGlobal = createTestGlobal();
    const nativeClearTimeout = testGlobal.clearTimeout;
    const clearedTimers: unknown[] = [];
    testGlobal.clearTimeout = (timer) => {
      clearedTimers.push(timer);
      nativeClearTimeout(timer);
    };
    const { teardown } = await environment.setup(testGlobal, {});
    let completedTimer: NodeJS.Timeout | undefined;
    let tornDown = false;

    try {
      await new Promise<void>((resolve) => {
        completedTimer = testGlobal.setTimeout(resolve, 0);
      });
      tornDown = true;
      await teardown();

      expect(clearedTimers).not.toContain(completedTimer);
    } finally {
      if (!tornDown) {
        await teardown();
      }
    }
  });
});
