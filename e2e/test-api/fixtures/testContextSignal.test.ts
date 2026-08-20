import { afterAll, expect, rstest, test } from '@rstest/core';

const signals: AbortSignal[] = [];
let attempts = 0;
let synchronousAbortAttempts = 0;
let failsSignalAborted = false;

test(
  'aborts the attempt signal on timeout and refreshes it for retry',
  { retry: 1, timeout: 50 },
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
              message: expect.stringContaining('test timed out in 50ms'),
            });
            console.log('RSTEST_TEST_CONTEXT_SIGNAL_ABORTED');
            resolve();
          },
          { once: true },
        );
      });
    }
  },
);

test(
  'times out before an abort listener resolves the callback',
  { retry: 1, timeout: 50 },
  ({ signal }) => {
    synchronousAbortAttempts++;

    if (synchronousAbortAttempts === 1) {
      return new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
    }

    return undefined;
  },
);

test.fails(
  'aborts the signal when a test.fails callback times out',
  { timeout: 50 },
  ({ signal }) =>
    new Promise<void>((resolve) => {
      signal.addEventListener(
        'abort',
        () => {
          failsSignalAborted = true;
          resolve();
        },
        { once: true },
      );
    }),
);

const objectFixtureTest = test.extend({ signal: 'fixture signal' });

objectFixtureTest('preserves object-form signal fixtures', ({ signal }) => {
  expect(signal).toBe('fixture signal');
});

test('captures the native AbortController before globals are stubbed', () => {
  rstest.stubGlobal(
    'AbortController',
    class StubAbortController {
      constructor() {
        throw new Error('AbortController was stubbed');
      }
    },
  );
});

test('creates a signal after AbortController is stubbed', ({ signal }) => {
  expect(signal).toBeInstanceOf(AbortSignal);
  rstest.unstubAllGlobals();
});

afterAll(() => {
  expect(attempts).toBe(2);
  expect(signals).toHaveLength(2);
  expect(signals[0]?.aborted).toBe(true);
  expect(signals[1]?.aborted).toBe(false);
  expect(signals[0]).not.toBe(signals[1]);
  expect(synchronousAbortAttempts).toBe(2);
  expect(failsSignalAborted).toBe(true);
});
