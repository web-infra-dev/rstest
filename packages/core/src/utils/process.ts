import type { ChildProcess } from 'node:child_process';

/**
 * Send a termination signal to a child process and wait for it to exit.
 * If `timeoutMs` is set, escalates to SIGKILL when the child does not
 * exit within the budget.
 *
 * If `child.kill` throws (ESRCH, channel already closed, etc.), the
 * child is treated as already gone and the promise resolves immediately
 * so callers never deadlock on an event that will never arrive.
 */
export function killAndWait(
  child: ChildProcess,
  signal: NodeJS.Signals = 'SIGTERM',
  timeoutMs?: number,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let forceKillTimer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
        forceKillTimer = undefined;
      }
    };

    const onExit = () => {
      cleanup();
      resolve();
    };

    child.once('exit', onExit);

    if (timeoutMs != null && timeoutMs > 0) {
      forceKillTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // already dead
        }
      }, timeoutMs);
      forceKillTimer.unref();
    }

    try {
      child.kill(signal);
    } catch {
      child.off('exit', onExit);
      cleanup();
      resolve();
    }
  });
}
