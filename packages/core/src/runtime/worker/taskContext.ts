import type { CurrentTaskInfo } from '../../types';

type TaskStorage = {
  getStore(): CurrentTaskInfo | undefined;
  run<T>(task: CurrentTaskInfo, fn: () => Promise<T> | T): Promise<T> | T;
};

type AsyncHooksModule = {
  AsyncLocalStorage?: new () => TaskStorage;
};

let taskStorage: TaskStorage | undefined;
let taskStorageReady = false;

let fallbackTask: CurrentTaskInfo | undefined;

export const initTaskContext = async (): Promise<void> => {
  if (taskStorageReady) {
    return;
  }

  taskStorageReady = true;

  try {
    const asyncHooksSpecifier = 'node:async_hooks';
    const { AsyncLocalStorage } = (await import(
      /* webpackIgnore: true */ asyncHooksSpecifier
    )) as AsyncHooksModule;
    taskStorage = AsyncLocalStorage ? new AsyncLocalStorage() : undefined;
  } catch {
    taskStorage = undefined;
  }
};

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
