import { describe, expect, it } from '@rstest/core';
import { runWatchRuntimeTeardown } from '../src/watchRuntime';

describe('runWatchRuntimeTeardown', () => {
  const createState = () => ({
    runtime: 'runtime-1' as string | null,
    cleanupPromise: null as Promise<void> | null,
  });

  it('destroys the runtime once for concurrent callers', async () => {
    const destroyed: string[] = [];
    const state = createState();

    await Promise.all([
      runWatchRuntimeTeardown(state, async (runtime) => {
        destroyed.push(runtime);
      }),
      runWatchRuntimeTeardown(state, async (runtime) => {
        destroyed.push(runtime);
      }),
    ]);

    expect(destroyed).toEqual(['runtime-1']);
    expect(state.runtime).toBeNull();
  });

  it('tears down the runtime a config restart re-cached', async () => {
    // The memo must not outlive the runtime it was taken for: a config-file
    // change tears the session down, re-caches a fresh runtime, and the next
    // teardown has to destroy that one rather than short-circuit on the
    // previous session's resolved promise.
    const destroyed: string[] = [];
    const state = createState();
    const destroy = async (runtime: string) => {
      destroyed.push(runtime);
    };

    await runWatchRuntimeTeardown(state, destroy);
    state.runtime = 'runtime-2';
    await runWatchRuntimeTeardown(state, destroy);

    expect(destroyed).toEqual(['runtime-1', 'runtime-2']);
    expect(state.runtime).toBeNull();
  });
});
