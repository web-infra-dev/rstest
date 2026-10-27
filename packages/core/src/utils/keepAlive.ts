/**
 * Runs `task` while holding a referenced timer.
 *
 * A pending promise does not keep Node's event loop alive on its own. Run-start
 * selection can finish before workers exist, so a hook that settles only after
 * an external signal has no referenced handle of its own, and the process could
 * exit with the hook still pending. The timer keeps the loop open for the whole
 * dispatch and is cleared as soon as the task settles, rejection included.
 */
export const keepEventLoopAlive = async <T>(
  task: () => Promise<T>,
): Promise<T> => {
  // The delay is irrelevant; only the referenced handle matters.
  const timer = setInterval(() => {}, 2 ** 30);
  try {
    return await task();
  } finally {
    clearInterval(timer);
  }
};
