import { setTimeout as nodeSetTimeout } from 'node:timers';
import { expect, it, rstest } from '@rstest/core';

it('uses jsdom timers as the real timers', () => {
  expect(setTimeout).toBe(window.setTimeout);
  expect(setTimeout).not.toBe(nodeSetTimeout);

  const timeout = setTimeout(() => {}, 0);
  expect(typeof timeout).toBe('number');
  clearTimeout(timeout);

  const interval = setInterval(() => {}, 0);
  expect(typeof interval).toBe('number');
  clearInterval(interval);
});

it('supports nested timers and cross-clearing', async () => {
  let intervalCalls = 0;
  const interval = setInterval(() => {
    intervalCalls++;
  }, 0);
  clearTimeout(interval);
  await new Promise((resolve) => nodeSetTimeout(resolve, 20));
  expect(intervalCalls).toBe(0);

  await new Promise<void>((resolve) => {
    const outer = setTimeout(() => {
      const inner = setTimeout(resolve, 0);
      expect(typeof inner).toBe('number');
    }, 0);
    expect(typeof outer).toBe('number');
  });
});

it('keeps browser callback semantics', async () => {
  const receiver = await new Promise<typeof globalThis>((resolve) => {
    setTimeout(function (this: typeof globalThis) {
      resolve(this);
    }, 0);
  });
  expect(receiver).toBe(window);

  window.setTimeout(() => {
    Reflect.set(window, 'timerProbe', 1);
  }, 0);
  await new Promise((resolve) => nodeSetTimeout(resolve, 20));
  expect(Reflect.get(window, 'timerProbe')).toBe(1);

  let frameCalled = false;
  const frame = requestAnimationFrame(() => {
    frameCalled = true;
  });
  expect(typeof frame).toBe('number');
  cancelAnimationFrame(frame);
  await new Promise((resolve) => nodeSetTimeout(resolve, 20));
  expect(frameCalled).toBe(false);
});

it('reports timer callback errors on window', async () => {
  const expected = new Error('timer error');
  const received = await new Promise<Error>((resolve) => {
    window.addEventListener(
      'error',
      (event) => {
        event.preventDefault();
        resolve(event.error);
      },
      { once: true },
    );
    setTimeout(() => {
      throw expected;
    }, 0);
  });

  expect(received).toBe(expected);
});

it('restores jsdom timers after fake timers', () => {
  const jsdomSetTimeout = setTimeout;

  rstest.useFakeTimers({ now: 0 });
  let called = false;
  setTimeout(() => {
    called = true;
  }, 10);
  rstest.advanceTimersByTime(10);
  expect(called).toBe(true);

  rstest.useRealTimers();
  expect(setTimeout).toBe(jsdomSetTimeout);

  const timeout = setTimeout(() => {}, 0);
  expect(typeof timeout).toBe('number');
  clearTimeout(timeout);
});

it('cleans up pending intervals during environment teardown', () => {
  const interval = setInterval(() => {}, 60_000);
  expect(typeof interval).toBe('number');
});
