/**
 * FIFO async semaphore shared by the headless and headed lanes of a mixed run,
 * so the number of test files running at once stays within one `maxWorkers`
 * budget across both lanes.
 */
export type ConcurrencyLimiter = {
  /** Resolves with an idempotent `release` once a slot is free. */
  acquire: () => Promise<() => void>;
  /** Run `task` while holding a slot; the slot is released even when it throws. */
  run: <T>(task: () => Promise<T>) => Promise<T>;
};

export const createConcurrencyLimiter = (limit: number): ConcurrencyLimiter => {
  const max = Math.max(1, Math.floor(limit));
  let active = 0;
  const waiters: Array<() => void> = [];

  const makeRelease = (): (() => void) => {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const next = waiters.shift();
      if (next) {
        // Hand the slot straight to the next waiter; `active` is unchanged.
        next();
      } else {
        active--;
      }
    };
  };

  const acquire = (): Promise<() => void> => {
    if (active < max) {
      active++;
      return Promise.resolve(makeRelease());
    }
    return new Promise((resolve) => {
      waiters.push(() => resolve(makeRelease()));
    });
  };

  const run = async <T>(task: () => Promise<T>): Promise<T> => {
    const release = await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  };

  return { acquire, run };
};
