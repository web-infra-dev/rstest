import { AsyncLocalStorage } from 'node:async_hooks';
import type { CurrentTaskInfo } from '../../types';
import type { TaskContext } from './taskContext';

export const createNodeTaskContext = (): TaskContext => {
  const storage = new AsyncLocalStorage<CurrentTaskInfo>();
  let fallback: CurrentTaskInfo | undefined;

  return {
    getCurrent: () => storage.getStore() ?? fallback,
    run: (task, fn) => storage.run(task, fn),
    setFallback: (task) => {
      fallback = task;
    },
  };
};
