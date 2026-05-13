import type { CurrentTaskInfo } from '../../types';
import type { TaskContext } from './taskContext';

// Browser fallback: single slot. Browsers lack AsyncLocalStorage, so concurrent
// tasks may mis-attribute — callers must layer a hook-driven mechanism for that.
export const createBrowserTaskContext = (): TaskContext => {
  let fallback: CurrentTaskInfo | undefined;

  return {
    getCurrent: () => fallback,
    run: async (task, fn) => {
      const previous = fallback;
      fallback = task;
      try {
        return await fn();
      } finally {
        fallback = previous;
      }
    },
    setFallback: (task) => {
      fallback = task;
    },
  };
};
