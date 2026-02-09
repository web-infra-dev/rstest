import type { ChildProcess } from 'node:child_process';
import type { Tinypool } from 'tinypool';

const MAX_CAPTURED_STDERR_BYTES = 128 * 1024;
const STDERR_SETTLE_MAX_WAIT = 200;
const WORKER_EXIT_ERROR = 'Worker exited unexpectedly';
const MAX_STDERR_MESSAGE_BYTES = 64 * 1024;

export interface WorkerMetaMessage {
  __rstest_worker_meta__: true;
  pid: number;
}

interface StderrChunk {
  bytes: number;
  seq: number;
  text: string;
}

interface WorkerStderrState {
  bytes: number;
  chunks: StderrChunk[];
  seq: number;
}

interface TaskBinding {
  pid: number;
  startSeq: number;
}

interface Deferred<T> {
  settled: boolean;
  resolve: (value: T) => void;
  promise: Promise<T>;
}

interface WorkerStderrCapture {
  createTask: (taskId: number) => void;
  bindTaskToPid: (taskId: number, pid: number) => void;
  clearTask: (taskId: number) => void;
  enhanceWorkerExitError: (taskId: number, err: unknown) => Promise<void>;
  cleanup: () => void;
}

export const isWorkerMetaMessage = (
  message: unknown,
): message is WorkerMetaMessage => {
  return !!(
    message &&
    typeof message === 'object' &&
    (message as { __rstest_worker_meta__?: unknown }).__rstest_worker_meta__ ===
      true &&
    typeof (message as { pid?: unknown }).pid === 'number'
  );
};

const createDeferred = <T>(): Deferred<T> => {
  let resolvePromise: (value: T) => void = () => undefined;

  const deferred: Deferred<T> = {
    settled: false,
    resolve(value) {
      if (deferred.settled) {
        return;
      }
      deferred.settled = true;
      resolvePromise(value);
    },
    promise: new Promise<T>((resolve) => {
      resolvePromise = resolve;
    }),
  };

  return deferred;
};

const withTimeout = <T>(
  promise: Promise<T>,
  timeout: number,
): Promise<T | undefined> => {
  return new Promise((resolve) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) {
        return;
      }
      finished = true;
      resolve(undefined);
    }, timeout);
    timer.unref();

    void promise.then(
      (value) => {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });
};

const formatCapturedStderr = (text: string): string => {
  const bytes = Buffer.byteLength(text);
  if (bytes <= MAX_STDERR_MESSAGE_BYTES) {
    return text;
  }

  const half = Math.floor(MAX_STDERR_MESSAGE_BYTES / 2);
  const head = text.slice(0, half);
  const tail = text.slice(-half);
  const hiddenBytes = bytes - Buffer.byteLength(head) - Buffer.byteLength(tail);

  return `${head}\n\n... [truncated ${hiddenBytes} bytes of stderr] ...\n\n${tail}`;
};

export const createWorkerStderrCapture = (
  pool: Tinypool,
): WorkerStderrCapture => {
  const workerStates = new Map<number, WorkerStderrState>();
  const taskBindings = new Map<number, TaskBinding>();
  const taskBindingWaiters = new Map<number, Deferred<TaskBinding>>();
  const workerCloseWaiters = new Map<number, Deferred<void>>();
  const closedWorkers = new Set<number>();
  const trackedWorkers = new Map<
    number,
    {
      onData: (chunk: Buffer | string) => void;
      stream: NodeJS.ReadableStream;
    }
  >();

  let scanner: NodeJS.Timeout | undefined;

  const getWorkerCloseWaiter = (pid: number): Deferred<void> => {
    let waiter = workerCloseWaiters.get(pid);
    if (!waiter) {
      waiter = createDeferred<void>();
      workerCloseWaiters.set(pid, waiter);
    }
    return waiter;
  };

  const getWorkerState = (pid: number): WorkerStderrState => {
    let state = workerStates.get(pid);
    if (!state) {
      state = {
        bytes: 0,
        chunks: [],
        seq: 0,
      };
      workerStates.set(pid, state);
    }
    return state;
  };

  const appendStderr = (pid: number, text: string): void => {
    if (!text) {
      return;
    }

    const state = getWorkerState(pid);
    const bytes = Buffer.byteLength(text);

    state.seq += 1;
    state.bytes += bytes;
    state.chunks.push({
      bytes,
      seq: state.seq,
      text,
    });

    while (state.bytes > MAX_CAPTURED_STDERR_BYTES && state.chunks.length > 0) {
      const dropped = state.chunks.shift();
      if (dropped) {
        state.bytes -= dropped.bytes;
      }
    }
  };

  const attachWorker = (worker: unknown): void => {
    const childProcess = (worker as { process?: ChildProcess }).process;
    const pid = childProcess?.pid;
    const stderr = childProcess?.stderr;

    if (!childProcess || !pid || !stderr) {
      return;
    }

    if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
      closedWorkers.add(pid);
      getWorkerCloseWaiter(pid).resolve(undefined);
    }

    if (trackedWorkers.has(pid)) {
      return;
    }

    const onData = (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString();
      appendStderr(pid, text);
    };

    stderr.on('data', onData);
    trackedWorkers.set(pid, {
      onData,
      stream: stderr,
    });

    childProcess.once('exit', () => {
      const tracked = trackedWorkers.get(pid);
      if (!tracked) {
        return;
      }
      tracked.stream.off('data', tracked.onData);
      trackedWorkers.delete(pid);
    });

    childProcess.once('close', () => {
      closedWorkers.add(pid);
      getWorkerCloseWaiter(pid).resolve(undefined);
    });
  };

  const attachWorkerByPid = (pid: number): void => {
    for (const worker of pool.threads) {
      const childProcess = (worker as { process?: ChildProcess }).process;
      if (childProcess?.pid === pid) {
        attachWorker(worker);
        return;
      }
    }
  };

  const scanWorkers = (): void => {
    for (const worker of pool.threads) {
      attachWorker(worker);
    }
  };

  scanWorkers();
  scanner = setInterval(scanWorkers, 10);
  scanner.unref();

  const createTask = (taskId: number): void => {
    if (!taskBindingWaiters.has(taskId)) {
      taskBindingWaiters.set(taskId, createDeferred<TaskBinding>());
    }
  };

  const bindTaskToPid = (taskId: number, pid: number): void => {
    attachWorkerByPid(pid);

    const state = getWorkerState(pid);
    const binding: TaskBinding = {
      pid,
      startSeq: state.seq,
    };

    taskBindings.set(taskId, binding);
    taskBindingWaiters.get(taskId)?.resolve(binding);
  };

  const waitForTaskBinding = async (
    taskId: number,
  ): Promise<TaskBinding | undefined> => {
    const binding = taskBindings.get(taskId);
    if (binding) {
      return binding;
    }

    const waiter = taskBindingWaiters.get(taskId);
    if (!waiter) {
      return undefined;
    }

    return withTimeout(waiter.promise, STDERR_SETTLE_MAX_WAIT);
  };

  const waitForWorkerClose = async (pid: number): Promise<void> => {
    if (closedWorkers.has(pid)) {
      return;
    }

    attachWorkerByPid(pid);
    await withTimeout(
      getWorkerCloseWaiter(pid).promise,
      STDERR_SETTLE_MAX_WAIT,
    );
  };

  const getTaskStderr = (taskId: number): string => {
    const binding = taskBindings.get(taskId);
    if (!binding) {
      return '';
    }

    const state = workerStates.get(binding.pid);
    if (!state || state.chunks.length === 0) {
      return '';
    }

    return state.chunks
      .filter((chunk) => chunk.seq > binding.startSeq)
      .map((chunk) => chunk.text)
      .join('')
      .trim();
  };

  const enhanceWorkerExitError = async (
    taskId: number,
    err: unknown,
  ): Promise<void> => {
    if (!(err instanceof Error) || !err.message.includes(WORKER_EXIT_ERROR)) {
      return;
    }

    const binding =
      taskBindings.get(taskId) ?? (await waitForTaskBinding(taskId));
    if (!binding) {
      return;
    }

    await waitForWorkerClose(binding.pid);
    const stderr = formatCapturedStderr(getTaskStderr(taskId));
    if (stderr.length > 0) {
      err.message += `\n\nMaybe related stderr:\n${stderr}`;
    }
  };

  const clearTask = (taskId: number): void => {
    taskBindings.delete(taskId);
    taskBindingWaiters.delete(taskId);
  };

  const cleanup = (): void => {
    if (scanner) {
      clearInterval(scanner);
      scanner = undefined;
    }

    for (const { onData, stream } of trackedWorkers.values()) {
      stream.off('data', onData);
    }

    trackedWorkers.clear();
    taskBindings.clear();
    taskBindingWaiters.clear();
    workerCloseWaiters.clear();
    closedWorkers.clear();
    workerStates.clear();
  };

  return {
    createTask,
    bindTaskToPid,
    clearTask,
    enhanceWorkerExitError,
    cleanup,
  };
};
