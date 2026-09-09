import type { TaskMeta, TaskMetaValue } from '../../types';

export const cloneTaskMetaValue = (value: TaskMetaValue): TaskMetaValue => {
  if (Array.isArray(value)) {
    return value.map(cloneTaskMetaValue);
  }

  if (value !== null && typeof value === 'object') {
    const cloned: Record<string, TaskMetaValue> = {};
    for (const key of Object.keys(value)) {
      cloned[key] = cloneTaskMetaValue(value[key]!);
    }
    return cloned;
  }

  return value;
};

export const cloneTaskMeta = (meta?: TaskMeta): TaskMeta => {
  const cloned: TaskMeta = {};
  if (!meta) return cloned;

  for (const key of Object.keys(meta)) {
    cloned[key] = cloneTaskMetaValue(meta[key]!);
  }
  return cloned;
};

export const mergeTaskMeta = (
  inherited: TaskMeta | undefined,
  local: TaskMeta | undefined,
): TaskMeta => ({
  ...cloneTaskMeta(inherited),
  ...cloneTaskMeta(local),
});
