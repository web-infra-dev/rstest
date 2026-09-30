import type { CurrentTaskInfo } from '../../types';
import type { TaskContext } from './taskContext';

// Browser fallback: single slot. Browsers lack AsyncLocalStorage, so concurrent
// tasks may mis-attribute — callers must not use it for task-specific behavior.
export const createBrowserTaskContext = (): TaskContext => {
  let fallback: { task: CurrentTaskInfo; signal?: AbortSignal } | undefined;
  let concurrentTaskCount = 0;

  return {
    getCurrent: () => fallback?.task,
    getCurrentSignal: () =>
      concurrentTaskCount === 0 ? fallback?.signal : undefined,
    run: async (task, fn, { concurrent = false } = {}) => {
      const previous = fallback;
      if (concurrent) {
        concurrentTaskCount++;
      }
      fallback = { task };
      try {
        return await fn();
      } finally {
        fallback = previous;
        if (concurrent) {
          concurrentTaskCount--;
        }
      }
    },
    setCurrentSignal: (signal) => {
      if (fallback) {
        fallback.signal = signal;
      }
    },
    setFallback: (task) => {
      fallback = task ? { task } : undefined;
    },
  };
};
