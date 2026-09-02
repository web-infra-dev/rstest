import type { CurrentTaskInfo } from '../../types';
import type { TaskContext } from './taskContext';

// Browsers lack AsyncLocalStorage. The fallback is therefore only reliable
// while one suite flow is running; runExclusive protects concurrent suite
// flows from overwriting one another across an await.
export const createBrowserTaskContext = (): TaskContext => {
  let fallback: CurrentTaskInfo | undefined;
  let exclusiveQueue: Promise<void> = Promise.resolve();
  let exclusiveOwner: object | undefined;

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
    runExclusive: async (token, fn) => {
      if (exclusiveOwner === token) {
        return fn();
      }

      const previous = exclusiveQueue;
      let release!: () => void;
      exclusiveQueue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      exclusiveOwner = token;
      try {
        return await fn();
      } finally {
        exclusiveOwner = undefined;
        release();
      }
    },
    setFallback: (task) => {
      fallback = task;
    },
  };
};
