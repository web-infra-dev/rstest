export type HeadedSerialTask = () => Promise<void>;

/**
 * Serializes headed browser file execution so only one task runs at a time.
 * The queue keeps draining even if an earlier task rejects.
 */
export const createHeadedSerialTaskQueue = () => {
  let queue: Promise<void> = Promise.resolve();

  const enqueue = (task: HeadedSerialTask): Promise<void> => {
    const next = queue.then(task);
    queue = next.catch(() => {});
    return next;
  };

  return {
    enqueue,
  };
};
