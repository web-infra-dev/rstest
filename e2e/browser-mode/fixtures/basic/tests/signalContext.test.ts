import { afterAll, expect, test } from '@rstest/core';

const signals: AbortSignal[] = [];
let attempts = 0;

test(
  'aborts the attempt signal on timeout and refreshes it for retry',
  { retry: 1, timeout: 100 },
  async ({ signal }) => {
    attempts++;
    signals.push(signal);
    expect(signal.aborted).toBe(false);

    if (attempts === 1) {
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            expect(signal.reason).toMatchObject({
              message: expect.stringContaining('test timed out in 100ms'),
            });
            console.log('RSTEST_BROWSER_CONTEXT_SIGNAL_ABORTED');
            resolve();
          },
          { once: true },
        );
      });
    }
  },
);

afterAll(() => {
  expect(attempts).toBe(2);
  expect(signals).toHaveLength(2);
  expect(signals[0]?.aborted).toBe(true);
  expect(signals[1]?.aborted).toBe(false);
  expect(signals[0]).not.toBe(signals[1]);
});
