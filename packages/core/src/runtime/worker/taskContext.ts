import type { CurrentTaskInfo } from '../../types';

type TaskStorage = {
  getStore(): CurrentTaskInfo | undefined;
  run<T>(task: CurrentTaskInfo, fn: () => Promise<T> | T): Promise<T> | T;
};

let taskStorage: TaskStorage | undefined;
let fallbackTask: CurrentTaskInfo | undefined;

export const getCurrentTask = (): CurrentTaskInfo | undefined => {
  return taskStorage?.getStore() ?? fallbackTask;
};

export const runWithCurrentTask = async <T>(
  task: CurrentTaskInfo,
  fn: () => Promise<T> | T,
): Promise<T> => {
  if (taskStorage) {
    return await taskStorage.run(task, fn);
  }

  const previousFallbackTask = fallbackTask;
  fallbackTask = task;

  try {
    return await fn();
  } finally {
    fallbackTask = previousFallbackTask;
  }
};

export const setFallbackCurrentTask = (
  task: CurrentTaskInfo | undefined,
): void => {
  fallbackTask = task;
};
