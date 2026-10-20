type SerialTask = () => Promise<void>;

type SerialTaskQueue = {
  enqueue: (task: SerialTask) => Promise<void>;
};

/**
 * Runs queued browser tasks one at a time.
 * The queue keeps draining even if an earlier task rejects.
 */
export const createSerialTaskQueue = (): SerialTaskQueue => {
  let queue: Promise<void> = Promise.resolve();

  const enqueue = (task: SerialTask): Promise<void> => {
    const next = queue.then(task);
    queue = next.catch(() => {});
    return next;
  };

  return {
    enqueue,
  };
};
