import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  rstest,
} from '@rstest/core';

describe('fake timers', () => {
  const time1 = new Date('2023-01-01T00:00:00Z');
  const time2 = new Date('2025-01-01T00:00:00Z');
  beforeEach(() => {
    rstest.useFakeTimers();
  });

  afterEach(() => {
    rstest.useRealTimers();
  });

  it('fake system time', async () => {
    expect(rstest.isFakeTimers()).toBe(true);

    rstest.setSystemTime(time1);

    expect(Date.now()).toBe(time1.getTime());

    expect(rstest.getRealSystemTime()).toBeGreaterThan(time2.getTime());

    rstest.useRealTimers();

    expect(rstest.isFakeTimers()).toBe(false);

    expect(Date.now()).toBeGreaterThan(time2.getTime());
  });

  it('runAllTimers', async () => {
    const cb = rstest.fn();
    setTimeout(cb, 0);
    expect(cb).toHaveBeenCalledTimes(0);

    rstest.runAllTimers();
    expect(cb).toHaveBeenCalledTimes(1);

    rstest.runAllTimers();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('advanceTimersByTime', async () => {
    const cb = rstest.fn();
    const cb1 = rstest.fn();
    setTimeout(cb, 100);
    setTimeout(cb1, 200);

    rstest.advanceTimersByTime(200);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb1).toHaveBeenCalledTimes(1);
  });

  it('advanceTimersToNextTimer', () => {
    const cb = rstest.fn();
    const cb1 = rstest.fn();
    setTimeout(cb, 100);
    setTimeout(cb1, 200);

    rstest.advanceTimersToNextTimer();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb1).toHaveBeenCalledTimes(0);
  });

  it('getTimerCount', () => {
    const cb = rstest.fn();
    const cb1 = rstest.fn();
    setTimeout(cb, 100);
    setTimeout(cb1, 200);

    expect(rstest.getTimerCount()).toBe(2);

    rstest.runAllTimers();
    expect(rstest.getTimerCount()).toBe(0);
  });

  it('should work with node:timers', async () => {
    const { setTimeout } = require('node:timers');
    const cb = rstest.fn();
    const cb1 = rstest.fn();
    setTimeout(cb, 100);
    setTimeout(cb1, 200);

    expect(rstest.getTimerCount()).toBe(2);

    rstest.runAllTimers();
    expect(rstest.getTimerCount()).toBe(0);

    let i = 0;

    await expect
      .poll(() => {
        i++;
        return i;
      })
      .toBe(3);
  });
});
