import type { MaybePromise } from './utils';

export interface TestEnvironmentReturn {
  /**
   * Only called for a `file`-scoped environment. A `worker`-scoped one lives
   * as long as the worker, so anything this would have drained must not be
   * accumulated in the first place (rstest#1644).
   */
  teardown: (global: any) => MaybePromise<void>;
}
export interface TestEnvironmentContext {
  /**
   * How long this environment instance lives: `file` is torn down when the
   * file finishes, `worker` is kept for the worker's whole life
   * (`isolate: false`).
   */
  scope: 'file' | 'worker';
}
export interface TestEnvironment<Global = any, Options = Record<string, any>> {
  name: string;
  setup: (
    global: Global,
    options: Options,
    context: TestEnvironmentContext,
  ) => MaybePromise<TestEnvironmentReturn>;
}
