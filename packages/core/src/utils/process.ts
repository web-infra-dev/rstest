import type { ChildProcess } from 'node:child_process';

/**
 * Send a termination signal to a child process and wait for it to exit.
 * If `timeoutMs` is set, escalates to SIGKILL when the child does not
 * exit within the budget.
 *
 * Safe to call on a child that has already exited: resolves immediately
 * instead of deadlocking on an 'exit' event that will never fire again.
 */
export function killAndWait(
  child: ChildProcess,
  signal: NodeJS.Signals = 'SIGTERM',
  timeoutMs?: number,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    let forceKillTimer: NodeJS.Timeout | undefined;

    const settle = () => {
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
        forceKillTimer = undefined;
      }
      child.off('exit', settle);
      resolve();
    };

    child.once('exit', settle);

    // Node's `child.kill` returns `false` (not throws) when the target
    // is already gone — e.g. ESRCH after the child exited between our
    // liveness check above and here. In both the `false` and thrown
    // paths the 'exit' event will never fire for our listener, so we
    // settle synchronously.
    let delivered = false;
    try {
      delivered = child.kill(signal);
    } catch {
      // treated the same as `delivered === false` below
    }
    if (!delivered) {
      settle();
      return;
    }

    if (timeoutMs != null && timeoutMs > 0) {
      forceKillTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // child died between SIGTERM and the escalation timer
        }
      }, timeoutMs);
      forceKillTimer.unref();
    }
  });
}
