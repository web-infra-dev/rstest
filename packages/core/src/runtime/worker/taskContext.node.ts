import { AsyncLocalStorage } from 'node:async_hooks';
import type { CurrentTaskInfo } from '../../types';
import type { TaskContext } from './taskContext';

export const createNodeTaskContext = (): TaskContext => {
  const storage = new AsyncLocalStorage<CurrentTaskInfo | null>();
  let fallback: CurrentTaskInfo | undefined;

  return {
    getCurrent: () => {
      const current = storage.getStore();
      return current === null ? undefined : (current ?? fallback);
    },
    run: (task, fn) => storage.run(task, fn),
    runWithoutTask: (fn) => storage.run(null, fn),
    setFallback: (task) => {
      fallback = task;
    },
  };
};
