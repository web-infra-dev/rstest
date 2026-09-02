import type { CurrentTaskInfo } from '../../types';
import type { TaskContext } from './taskContext';

// Browsers lack AsyncLocalStorage. The fallback is therefore only reliable
// while one suite lifecycle is running; runExclusive protects concurrent suite
// lifecycles from overwriting one another across an await.
export const createBrowserTaskContext = (): TaskContext => {
  let fallback: CurrentTaskInfo | undefined;
  let exclusiveQueue: Promise<void> = Promise.resolve();

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
    runExclusive: async (fn) => {
      const previous = exclusiveQueue;
      let release!: () => void;
      exclusiveQueue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await fn();
      } finally {
        release();
      }
    },
    setFallback: (task) => {
      fallback = task;
    },
  };
};
