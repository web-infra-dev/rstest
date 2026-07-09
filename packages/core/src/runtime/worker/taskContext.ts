import type { CurrentTaskInfo } from '../../types';

/** Per-platform task attribution primitive used by the shared runner. */
export interface TaskContext {
  getCurrent(): CurrentTaskInfo | undefined;
  run<T>(task: CurrentTaskInfo, fn: () => T | Promise<T>): T | Promise<T>;
  setFallback(task: CurrentTaskInfo | undefined): void;
}
