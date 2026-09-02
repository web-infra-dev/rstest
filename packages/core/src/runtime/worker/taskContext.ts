import type { CurrentTaskInfo } from '../../types';

/** Per-platform task attribution primitive used by the shared runner. */
export interface TaskContext {
  getCurrent(): CurrentTaskInfo | undefined;
  run<T>(task: CurrentTaskInfo, fn: () => T | Promise<T>): T | Promise<T>;
  /**
   * Run a task exclusively when the platform cannot preserve async context.
   * Node's AsyncLocalStorage makes this a no-op; browser mode uses it for
   * concurrent suite lifecycles so an awaited hook cannot inherit a sibling.
   */
  runExclusive?<T>(fn: () => T | Promise<T>): T | Promise<T>;
  setFallback(task: CurrentTaskInfo | undefined): void;
}
