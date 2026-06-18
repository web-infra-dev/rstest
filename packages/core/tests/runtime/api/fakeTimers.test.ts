import { createRstestUtilities } from '../../../src/runtime/api/utilities';
import { setRealTimers } from '../../../src/runtime/util';
import type { WorkerState } from '../../../src/types';

function createWorkerState(): WorkerState {
  return {
    runtimeConfig: {
      testTimeout: 1_000,
      hookTimeout: 1_000,
      clearMocks: false,
      resetMocks: false,
      restoreMocks: false,
      maxConcurrency: 5,
      retry: 0,
    },
  } as WorkerState;
}

describe('fake timers API', () => {
  beforeEach(() => {
    setRealTimers();
  });

  it('useFakeTimers not throws when specifies `toNotFake`', async () => {
    const rs = await createRstestUtilities(createWorkerState());

    expect(() =>
      rs.useFakeTimers({ toNotFake: ['setImmediate'] }),
    ).not.toThrow();

    rs.useRealTimers();
  });

  it('useFakeTimers filters out timers in toNotFake', async () => {
    const rs = await createRstestUtilities(createWorkerState());

    rs.useFakeTimers({ toNotFake: ['setTimeout'] });

    let fired = false;
    setTimeout(() => {
      fired = true;
    }, 5);

    rs.advanceTimersByTime(10); // proves that setTimeout is not mocked
    expect(fired).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fired).toBe(true);

    rs.useRealTimers();
  });

  it('advanceTimersByTime accepts string durations', async () => {
    const rs = await createRstestUtilities(createWorkerState());
    rs.useFakeTimers({ now: 0 });

    let fired = false;
    setTimeout(() => {
      fired = true;
    }, 1000);

    rs.advanceTimersByTime('00:01');

    expect(fired).toBe(true);
    expect(Date.now()).toBe(1000);

    rs.useRealTimers();
  });

  it('setSystemTime accepts Temporal-like values', async () => {
    const rs = await createRstestUtilities(createWorkerState());
    rs.useFakeTimers({ now: 0 });

    rs.setSystemTime({ epochMilliseconds: 1234 });

    expect(Date.now()).toBe(1234);

    rs.useRealTimers();
  });

  it('jumpTimersByTime fires recurring timers at most once', async () => {
    const rs = await createRstestUtilities(createWorkerState());
    rs.useFakeTimers({ now: 0 });

    const cb = rs.fn();
    setInterval(cb, 1000);

    rs.jumpTimersByTime(5000);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(Date.now()).toBe(5000);

    rs.useRealTimers();
  });

  it('setTickMode supports nextAsync auto ticking', async () => {
    const rs = await createRstestUtilities(createWorkerState());
    rs.useFakeTimers({ now: 0 });

    const result = new Promise((resolve) => {
      setTimeout(() => resolve(Date.now()), 1000);
    });

    rs.setTickMode({ mode: 'nextAsync' });

    await expect(result).resolves.toBe(1000);

    rs.useRealTimers();
  });

  it('restores tick mode after scoped fake timers dispose', async () => {
    const rs = await createRstestUtilities(createWorkerState());
    rs.useFakeTimers({ now: 0 });
    rs.setTickMode({ mode: 'nextAsync' });

    const scoped = rs.useFakeTimers({ now: 100 });
    scoped[Symbol.dispose]?.();

    const result = new Promise((resolve) => {
      setTimeout(() => resolve(Date.now()), 1000);
    });

    await expect(result).resolves.toBe(1000);

    rs.useRealTimers();
  });
});
