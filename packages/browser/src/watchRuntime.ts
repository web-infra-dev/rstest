import { destroyBrowserRuntime, type BrowserRuntime } from './browserRsbuild';

// The runtime is reused across controller re-entry. Diff/rerun state belongs
// to BrowserRuntime.watchState; core owns process signals and teardown order.
export type WatchContext = {
  runtime: BrowserRuntime | null;
  cleanupPromise: Promise<void> | null;
};

export const watchContext: WatchContext = {
  runtime: null,
  cleanupPromise: null,
};

/**
 * Tear down the persistent watch runtime (dev servers, provider, browser,
 * WebSocket server). Idempotent, and the single teardown reached by the browser
 * executor's `close` and the host controller's abort listener.
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
  runWatchRuntimeTeardown(watchContext, destroyBrowserRuntime);
