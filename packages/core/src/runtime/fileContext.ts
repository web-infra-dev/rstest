import type { WorkerState } from '../types';
import type { TestRunner } from './runner/runner';
import type { RunnerRuntime } from './runner/runtime';

/**
 * The running test file's per-file state, published as ONE unit.
 *
 * Under `isolate: false` one worker runs many files while user modules persist
 * across them, so every context-bound `@rstest/core` API is a build-once stable
 * value that resolves this context at call time instead of closing over a
 * per-file instance (the live-binding contract, see `./api`). This module is
 * the single rebinding point: `createRunner` constructs all three members per
 * file and publishes them together.
 */
export interface FileContext {
  workerState: WorkerState;
  /** Collection-phase registrar (`describe`/`it`/hooks land here). */
  runnerRuntime: RunnerRuntime;
  /** Execution-phase runner (current test, `onTestFinished`/`onTestFailed`). */
  testRunner: TestRunner;
}

// A module-level binding (not a globalThis slot) is sufficient: this module is
// instantiated once per worker process (or per browser iframe) and is never
// part of the per-file user-bundle cache eviction.
let current: FileContext | undefined;

export const setFileContext = (context: FileContext): void => {
  current = context;
};

/**
 * Resolve the running file's context. Throws when called outside a prepared
 * rstest runtime (e.g. importing `@rstest/core` APIs in a plain node script).
 */
export const fileContext = (): FileContext => {
  if (!current) {
    throw new Error(
      'Rstest runtime is not registered yet, please make sure you are running in a rstest environment.',
    );
  }
  return current;
};
