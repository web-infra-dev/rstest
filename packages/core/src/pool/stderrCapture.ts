import { EventEmitter } from 'node:events';

export const STDERR_EVENT = 'rstest:stderr';

const stderrBus = new EventEmitter();

export const emitStderr = (msg: string): void => {
  stderrBus.emit(STDERR_EVENT, msg);
};

const MAX_STDERR_LINES = 100;

/**
 * Captures stderr output from child processes so that it can be
 * attached to "Worker exited unexpectedly" errors.
 *
 * Tinypool pipes child process stderr directly to `process.stderr`,
 * so when a worker crashes we lose the association between stderr
 * output and the error. This utility intercepts `process.stderr.write`
 * **and** listens for the `STDERR_EVENT` emitted by `WindowRenderer`
 * (which may buffer stderr data for rendering) to reliably collect
 * recent stderr lines.
 */
export function createStderrCapture(): {
  enhanceWorkerError: (err: unknown) => Promise<unknown>;
  cleanup: () => void;
} {
  const stderrBuffer: string[] = [];

  const captureStderr = (text: string) => {
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.length > 0) {
        stderrBuffer.push(line);
      }
    }
    // Keep only the most recent lines
    while (stderrBuffer.length > MAX_STDERR_LINES) {
      stderrBuffer.shift();
    }
  };

  // Intercept process.stderr.write
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (
    chunk: Uint8Array | string,
    ...args: any[]
  ): boolean => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString();
    captureStderr(text);
    return originalStderrWrite(chunk, ...args);
  };

  // Also listen for stderr data forwarded by WindowRenderer,
  // which may intercept process.stderr.write and buffer the data
  const onStderrEvent = (text: string) => {
    captureStderr(text);
  };

  stderrBus.on(STDERR_EVENT, onStderrEvent);

  const flushStderrBuffer = (): string => {
    const captured = stderrBuffer.join('\n');
    stderrBuffer.length = 0;
    return captured;
  };

  /**
   * Wait for stderr pipe to settle, then attach captured output to
   * "Worker exited unexpectedly" errors.
   */
  const enhanceWorkerError = async (err: unknown): Promise<unknown> => {
    if (
      err instanceof Error &&
      err.message.startsWith('Worker exited unexpectedly')
    ) {
      // The child process stderr is piped via streams, so data may still be
      // in the pipe buffer when the 'exit' event fires and the error is rejected.
      // Use a debounce approach: keep waiting as long as new stderr data is
      // still arriving, so we reliably capture everything regardless of load.
      const CHECK_INTERVAL = 10;
      const STABLE_THRESHOLD = 3; // require 3 consecutive stable checks (~30ms quiet)
      const MAX_WAIT = 500; // never wait longer than 500ms total

      let prevLength = stderrBuffer.length;
      let stableCount = 0;
      let waited = 0;

      while (stableCount < STABLE_THRESHOLD && waited < MAX_WAIT) {
        await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL));
        waited += CHECK_INTERVAL;
        if (stderrBuffer.length !== prevLength) {
          // new data arrived, reset stability counter
          prevLength = stderrBuffer.length;
          stableCount = 0;
        } else {
          stableCount++;
        }
      }

      const stderr = flushStderrBuffer();
      if (stderr) {
        err.message += `\n\nCaptured worker stderr:\n${stderr}`;
      }
    }
    return err;
  };

  const cleanup = (): void => {
    process.stderr.write = originalStderrWrite;
    stderrBus.removeAllListeners(STDERR_EVENT);
    stderrBus.off(STDERR_EVENT, onStderrEvent);
  };

  return { enhanceWorkerError, cleanup };
}
