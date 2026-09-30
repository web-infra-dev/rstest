import { AsyncLocalStorage } from 'node:async_hooks';
import type { CurrentTaskInfo } from '../../types';
import type { TaskContext } from './taskContext';

export const createNodeTaskContext = (): TaskContext => {
  const storage = new AsyncLocalStorage<{
    task: CurrentTaskInfo;
    signal?: AbortSignal;
  }>();
  let fallback: { task: CurrentTaskInfo; signal?: AbortSignal } | undefined;

  return {
    getCurrent: () => (storage.getStore() ?? fallback)?.task,
    getCurrentSignal: () => (storage.getStore() ?? fallback)?.signal,
    run: (task, fn) => storage.run({ task }, fn),
    setCurrentSignal: (signal) => {
      const current = storage.getStore();
      if (current) {
        storage.enterWith({ task: current.task, signal });
      } else if (fallback) {
        fallback = { task: fallback.task, signal };
      }
    },
    setFallback: (task) => {
      fallback = task ? { task } : undefined;
    },
  };
};
