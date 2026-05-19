import type { MaybePromise } from './utils';

export interface TestEnvironmentReturn {
  /**
   * Full teardown of the test environment. Called at the end of a test file's
   * execution when `isolate: true` or `isolate: false`. Implementations should
   * release every resource (e.g. close the JSDOM window, remove globals).
   */
  teardown: (global: any) => MaybePromise<void>;
  /**
   * Soft reset between test files when the worker process is reused
   * (`isolate: 'soft'`). The environment should clear per-file mutable state
   * (DOM tree, location, transient event listeners) without releasing
   * resources that are expensive to recreate. After `reset`, the environment
   * must still be usable for the next file.
   *
   * Optional — when absent, rstest falls back to `teardown` + a fresh
   * `setup`, which still works but defeats the perf benefit of soft isolate.
   */
  reset?: (global: any) => MaybePromise<void>;
}
export interface TestEnvironment<Global = any, Options = Record<string, any>> {
  name: string;
  setup: (
    global: Global,
    options: Options,
  ) => MaybePromise<TestEnvironmentReturn>;
}
