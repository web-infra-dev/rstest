/**
 * @rstest-environment jsdom
 *
 * Deliberately leaks unawaited async work so the next file's
 * `preparePool` exercises the `drainPendingAsyncFromPriorFile` absorber.
 *
 * If the absorber regresses (removed, drain count too low, listener
 * install/remove order wrong), this file's leak surfaces as an
 * `unhandledRejection` attributed to file-b or file-c → suite fails.
 * With the absorber working, the leak is silently absorbed and
 * subsequent files run cleanly.
 */
import { describe, expect, it } from '@rstest/core';

declare global {
  // eslint-disable-next-line no-var
  var __soft_file_seq__: string[] | undefined;
}

globalThis.__soft_file_seq__ ??= [];
globalThis.__soft_file_seq__.push('file-leaker');

describe('soft mode — leaker (exercises the absorber)', () => {
  it('finishes without awaiting a deferred rejection', () => {
    // Schedule a rejection that will fire AFTER this test's microtask
    // queue has drained — i.e. after the file's slot has closed. The
    // worker survives because soft mode drains + absorbs before
    // installing the next file's per-file `unhandledRejection` handler.
    setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      Promise.reject(
        new Error('intentional leak — should be absorbed by drain'),
      );
    }, 0);

    // Also schedule a deferred uncaughtException-style throw. Same idea:
    // it must not surface in the next file's slot.
    setTimeout(() => {
      throw new Error('intentional leak — should be absorbed by drain');
    }, 0);

    // Assert something trivial so this counts as a passing test.
    expect(true).toBe(true);
  });
});
