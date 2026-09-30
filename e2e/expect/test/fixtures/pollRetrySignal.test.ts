import { expect, test } from '@rstest/core';

let retryStarted = false;
let stalePollStarted = false;
let stalePollSettled = false;

test(
  'keeps a delayed poll bound to the attempt that created it',
  { retry: 1, timeout: 50 },
  async ({ task }) => {
    if (task.retryCount === 0) {
      const pending = expect
        .poll(
          () => {
            stalePollStarted = true;
            throw new Error('not ready');
          },
          { interval: 1, timeout: 100 },
        )
        .toBe(true);

      void (async () => {
        while (!retryStarted) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        try {
          await pending;
        } catch {
          stalePollSettled = true;
        }
      })();

      await new Promise(() => {});
    }

    retryStarted = true;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(stalePollStarted).toBe(false);
    expect(stalePollSettled).toBe(true);
  },
);
