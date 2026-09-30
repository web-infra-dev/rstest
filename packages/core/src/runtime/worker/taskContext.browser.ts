import type { CurrentTaskInfo } from '../../types';
import type { TaskContext } from './taskContext';

// Browser fallback: single slot. Browsers lack AsyncLocalStorage, so concurrent
// tasks may mis-attribute — callers must not use it for task-specific behavior.
export const createBrowserTaskContext = (): TaskContext => {
  let fallback: { task: CurrentTaskInfo; signal?: AbortSignal } | undefined;

  return {
    getCurrent: () => fallback?.task,
    getCurrentSignal: () => fallback?.signal,
    run: async (task, fn) => {
      const previous = fallback;
      fallback = { task };
      try {
        return await fn();
      } finally {
        fallback = previous;
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
