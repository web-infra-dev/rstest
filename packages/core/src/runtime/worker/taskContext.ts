import type { CurrentTaskInfo } from '../../types';

/** Per-platform task attribution primitive used by the shared runner. */
export interface TaskContext {
  getCurrent(): CurrentTaskInfo | undefined;
  run<T>(task: CurrentTaskInfo, fn: () => T | Promise<T>): T | Promise<T>;
  /**
   * Run a task exclusively when the platform cannot preserve async context.
   * Node's AsyncLocalStorage makes this a no-op; browser mode uses it for
   * concurrent suite flows so an awaited hook cannot inherit a sibling. The
   * token makes nested suites reentrant within the same flow.
   */
  runExclusive?<T>(token: object, fn: () => T | Promise<T>): T | Promise<T>;
  setFallback(task: CurrentTaskInfo | undefined): void;
}
