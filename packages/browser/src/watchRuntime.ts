import { FATAL_SIGNALS } from '@rstest/core/internal/browser';
import { destroyBrowserRuntime, type BrowserRuntime } from './browserRsbuild';

// Only process-wide concerns stay module-level: the runtime handle reused
// across controller re-entry (config-change restarts), and the signal/exit
// cleanup that must run once per process. Diff/rerun state lives on
// `BrowserRuntime.watchState`.
export type WatchContext = {
  runtime: BrowserRuntime | null;
  cleanupRegistered: boolean;
  cleanupPromise: Promise<void> | null;
};

export const watchContext: WatchContext = {
  runtime: null,
  cleanupRegistered: false,
  cleanupPromise: null,
};

/**
 * Tear down the persistent watch runtime (dev servers, provider, browser,
 * WebSocket server). Idempotent, and the single teardown the browser executor's
 * `close` and the process-exit nets both go through.
 */
export const runWatchRuntimeTeardown = <T>(
  state: { runtime: T | null; cleanupPromise: Promise<void> | null },
  destroy: (runtime: T) => Promise<void>,
): Promise<void> => {
  if (state.cleanupPromise) {
    return state.cleanupPromise;
  }

  state.cleanupPromise = (async () => {
    if (!state.runtime) {
      return;
    }

    await destroy(state.runtime);
    state.runtime = null;
  })();

  // The memo is released once this teardown settles, because the state outlives
  // the session: a config-file change restarts the run against a fresh runtime,
  // and a memo left resolved from the previous session would make every later
  // teardown a no-op — leaving the session after that to reuse a runtime built
  // from the pre-restart config. Idempotency only has to hold within a runtime.
  return state.cleanupPromise.finally(() => {
    state.cleanupPromise = null;
  });
};

export const cleanupWatchRuntime = (): Promise<void> =>
  // `cleanupRegistered` is deliberately not re-armed alongside the memo: the
  // signal nets it installs read `watchContext.runtime` live, so they stay
  // correct across a restart, and re-registering would stack a fresh set of
  // listeners on every one.
  runWatchRuntimeTeardown(watchContext, destroyBrowserRuntime);

export const registerWatchCleanup = (embedded: boolean): void => {
  if (watchContext.cleanupRegistered) {
    return;
  }
  watchContext.cleanupRegistered = true;

  // Embedded (programmatic) hosts own the process lifecycle; they tear the
  // session down through the browser executor's `close` instead of signals.
  if (embedded) {
    return;
  }

  // Cleanup-only nets: core's watch loop owns the signal → exit-code path and
  // awaits the same idempotent `cleanupWatchRuntime` promise through the
  // browser executor's `close`.
  for (const signal of FATAL_SIGNALS) {
    process.once(signal, () => {
      void cleanupWatchRuntime();
    });
  }

  process.once('exit', () => {
    void cleanupWatchRuntime();
  });
};
