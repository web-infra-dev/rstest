import type { CurrentTaskInfo } from '../../types';

/** Per-platform task attribution primitive used by the shared runner. */
export interface TaskContext {
  getCurrent(): CurrentTaskInfo | undefined;
  getCurrentSignal(): AbortSignal | undefined;
  run<T>(
    task: CurrentTaskInfo,
    fn: () => T | Promise<T>,
    options?: { concurrent?: boolean },
  ): T | Promise<T>;
  setCurrentSignal(signal: AbortSignal): void;
  setFallback(task: CurrentTaskInfo | undefined): void;
}
