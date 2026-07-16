import { setTimeout as nodeSetTimeout } from 'node:timers';
import { describe, expect, it } from '@rstest/core';
import { environment } from '../../../../src/runtime/worker/env/jsdom';

describe('jsdom environment', () => {
  it('uses window timers and clears them during teardown', async () => {
    const nodeTimers = {
      clearInterval: globalThis.clearInterval,
      clearTimeout: globalThis.clearTimeout,
      setInterval: globalThis.setInterval,
      setTimeout: globalThis.setTimeout,
    };
    const nodeFetch = globalThis.fetch;
    const { teardown } = await environment.setup(globalThis, {});
    let tornDown = false;

    try {
      expect(globalThis.setTimeout).toBe(window.setTimeout);
      expect(globalThis.setTimeout).not.toBe(nodeTimers.setTimeout);
      expect(globalThis.clearTimeout).not.toBe(nodeTimers.clearTimeout);
      expect(globalThis.setInterval).not.toBe(nodeTimers.setInterval);
      expect(globalThis.clearInterval).not.toBe(nodeTimers.clearInterval);
      expect(globalThis.fetch).not.toBe(nodeFetch);

      let intervalCalls = 0;
      let resolveFirstInterval = () => {};
      const firstInterval = new Promise<void>((resolve) => {
        resolveFirstInterval = resolve;
      });
      const interval = setInterval(() => {
        intervalCalls++;
        resolveFirstInterval();
      }, 1);
      expect(typeof interval).toBe('number');
      await firstInterval;
      const callsBeforeTeardown = intervalCalls;

      await teardown();
      tornDown = true;
      await new Promise((resolve) => nodeSetTimeout(resolve, 20));

      expect(intervalCalls).toBe(callsBeforeTeardown);
      expect(globalThis.setTimeout).toBe(nodeTimers.setTimeout);
      expect(globalThis.clearTimeout).toBe(nodeTimers.clearTimeout);
      expect(globalThis.setInterval).toBe(nodeTimers.setInterval);
      expect(globalThis.clearInterval).toBe(nodeTimers.clearInterval);
      expect(globalThis.fetch).toBe(nodeFetch);
    } finally {
      if (!tornDown) {
        await teardown();
      }
    }
  });

  it('installs window timers before the user beforeParse hook', async () => {
    const nodeSetTimeout = globalThis.setTimeout;
    let beforeParseSetTimeout: Window['setTimeout'] | undefined;
    let beforeParseTimerType: string | undefined;
    const { teardown } = await environment.setup(globalThis, {
      beforeParse(window) {
        beforeParseSetTimeout = window.setTimeout;
        const timer = window.setTimeout(() => {}, 0);
        beforeParseTimerType = typeof timer;
        window.clearTimeout(timer);
      },
    });

    try {
      expect(beforeParseSetTimeout).not.toBe(nodeSetTimeout);
      expect(beforeParseTimerType).toBe('number');

      const timer = setTimeout(() => {}, 0);
      expect(typeof timer).toBe('number');
      clearTimeout(timer);
    } finally {
      await teardown();
    }
  });
});
