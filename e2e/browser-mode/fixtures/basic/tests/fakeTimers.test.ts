import { afterEach, describe, expect, it, rstest } from '@rstest/core';

describe('Fake timers', () => {
  afterEach(() => {
    if (rstest.isFakeTimers()) {
      rstest.useRealTimers();
    }
  });

  it('should fake and restore browser timer globals', () => {
    const RealDate = Date;
    const realSetTimeout = globalThis.setTimeout;

    expect(rstest.isFakeTimers()).toBe(false);

    rstest.useFakeTimers({ now: 1000 });

    expect(rstest.isFakeTimers()).toBe(true);
    expect(Date).not.toBe(RealDate);
    expect(globalThis.setTimeout).not.toBe(realSetTimeout);
    expect(Date.now()).toBe(1000);
    expect(new Date().getTime()).toBe(1000);
    expect(performance.now()).toBe(0);

    rstest.useRealTimers();

    expect(rstest.isFakeTimers()).toBe(false);
    expect(Date).toBe(RealDate);
    expect(globalThis.setTimeout).toBe(realSetTimeout);
  });

  it('should run and clear timeout and interval timers', () => {
    rstest.useFakeTimers({ now: 0 });

    const timeout = rstest.fn();
    const clearedTimeout = rstest.fn();
    const interval = rstest.fn();

    globalThis.setTimeout(timeout, 100);
    const timeoutId = globalThis.setTimeout(clearedTimeout, 100);
    globalThis.clearTimeout(timeoutId);
    const intervalId = globalThis.setInterval(interval, 50);

    expect(rstest.getTimerCount()).toBe(2);

    rstest.advanceTimersByTime(100);

    expect(timeout).toHaveBeenCalledTimes(1);
    expect(clearedTimeout).toHaveBeenCalledTimes(0);
    expect(interval).toHaveBeenCalledTimes(2);
    expect(Date.now()).toBe(100);

    globalThis.clearInterval(intervalId);
    expect(rstest.getTimerCount()).toBe(0);
  });

  it('should run all timers and pending timers', () => {
    rstest.useFakeTimers({ now: 0 });

    const calls: string[] = [];
    globalThis.setTimeout(() => calls.push('timeout-100'), 100);
    globalThis.setTimeout(() => calls.push('timeout-200'), 200);

    rstest.runOnlyPendingTimers();

    expect(calls).toEqual(['timeout-100', 'timeout-200']);
    expect(Date.now()).toBe(200);

    globalThis.setTimeout(() => {
      calls.push('outer');
      globalThis.setTimeout(() => calls.push('inner'), 10);
    }, 10);

    rstest.runAllTimers();

    expect(calls).toEqual(['timeout-100', 'timeout-200', 'outer', 'inner']);
    expect(rstest.getTimerCount()).toBe(0);
  });

  it('should advance timers asynchronously', async () => {
    rstest.useFakeTimers({ now: 0 });

    const result = new Promise<number>((resolve) => {
      globalThis.setTimeout(() => {
        Promise.resolve().then(() => resolve(Date.now()));
      }, 100);
    });

    await rstest.advanceTimersByTimeAsync(100);

    await expect(result).resolves.toBe(100);
  });

  it('should advance to next timer', async () => {
    rstest.useFakeTimers({ now: 0 });

    const calls: string[] = [];
    globalThis.setTimeout(() => calls.push('first'), 100);
    globalThis.setTimeout(() => calls.push('second'), 200);

    rstest.advanceTimersToNextTimer();

    expect(calls).toEqual(['first']);
    expect(Date.now()).toBe(100);

    await rstest.advanceTimersToNextTimerAsync();

    expect(calls).toEqual(['first', 'second']);
    expect(Date.now()).toBe(200);
  });

  it('should advance animation frames', () => {
    rstest.useFakeTimers({ now: 0 });

    const cb = rstest.fn<(time: number) => void>();
    globalThis.requestAnimationFrame(cb);

    rstest.advanceTimersToNextFrame();

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]?.[0]).toBe(16);
    expect(Date.now()).toBe(16);
  });

  it('should flush faked microtasks', () => {
    rstest.useFakeTimers({ now: 0, toFake: ['queueMicrotask'] });

    let called = false;
    globalThis.queueMicrotask(() => {
      called = true;
    });

    expect(called).toBe(false);

    rstest.runAllTicks();

    expect(called).toBe(true);
  });

  it('should set, reset, and clear fake timers', () => {
    rstest.useFakeTimers({ now: 1000 });

    rstest.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    expect(Date.now()).toBe(1704067200000);

    rstest.setSystemTime({ epochMilliseconds: 1234 });
    expect(Date.now()).toBe(1234);

    const cb = rstest.fn();
    globalThis.setTimeout(cb, 100);
    expect(rstest.getTimerCount()).toBe(1);

    rstest.clearAllTimers();
    expect(rstest.getTimerCount()).toBe(0);

    rstest.advanceTimersByTime(100);
    expect(cb).toHaveBeenCalledTimes(0);
  });

  it('should advance timers with string durations', () => {
    rstest.useFakeTimers({ now: 0 });

    let called = false;
    globalThis.setTimeout(() => {
      called = true;
    }, 1000);

    rstest.advanceTimersByTime('00:01');

    expect(called).toBe(true);
    expect(Date.now()).toBe(1000);
  });

  it('should jump timers by time', () => {
    rstest.useFakeTimers({ now: 0 });

    const interval = rstest.fn();
    globalThis.setInterval(interval, 1000);

    rstest.jumpTimersByTime(5000);

    expect(interval).toHaveBeenCalledTimes(1);
    expect(Date.now()).toBe(5000);
  });

  it('should support nextAsync tick mode', async () => {
    rstest.useFakeTimers({ now: 0 });

    const timeout = new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, 1000);
    });

    rstest.setTickMode({ mode: 'nextAsync' });
    await timeout;

    expect(Date.now()).toBe(1000);
  });

  it('should keep excluded timers real', async () => {
    rstest.useFakeTimers({ now: 0, toNotFake: ['setTimeout'] });

    let called = false;
    const timeout = new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, 0);
    }).then(() => {
      called = true;
    });

    rstest.advanceTimersByTime(1000);
    expect(called).toBe(false);

    await timeout;
    expect(called).toBe(true);
  });
});
