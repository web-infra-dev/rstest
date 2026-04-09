import './setup';
import {
  type WorkerRequest,
  type WorkerResponse,
  isWorkerRequestEnvelope,
  serializeError,
  wrapWorkerResponse,
} from '../../pool/protocol';
import { runInPool } from './runInPool';

const send = (response: WorkerResponse): void => {
  if (typeof process.send !== 'function') return;
  try {
    process.send(wrapWorkerResponse(response));
  } catch {
    // Channel may already be closed during shutdown — ignore.
  }
};

let currentTaskId: number | undefined;
let stopRequested = false;
/**
 * Set when a stop arrived mid-task. The task handler drains teardown in its
 * own `finally` first; only then do we flush `stopped` and exit. Without the
 * deferral `process.exit(0)` would orphan env/coverage/mock cleanup and the
 * `process.exit` / `process.kill` restoration.
 */
let exitOnTaskIdle = false;
/**
 * Set when a task handler has reported `fatal_error` and is on its way to
 * exit. Suppresses the bottom-of-the-stack `fatalExit` from racing in with a
 * second fatal_error during the same death sequence.
 */
let dyingFromFatal = false;

const sendFatalError = (err: unknown): void => {
  send({
    type: 'fatal_error',
    error: serializeError(err),
  });
};

const finalizeStop = (): void => {
  send({ type: 'stopped' });
  setImmediate(() => process.exit(0));
};

/**
 * Last-resort handlers. The runtime's `runInPool` registers its own
 * uncaught/unhandled handlers that capture errors thrown WHILE a test is
 * running and feed them into the test result. These bottom-of-the-stack
 * handlers fire only when no task is active (e.g., during worker bootstrap,
 * teardown after the result has been flushed, or async leak after the
 * test completes), and surface a structured `fatal_error` to the host
 * before exiting. This is the structured replacement for
 * `patches/tinypool@2.1.0.patch`.
 */
const fatalExit = (err: unknown): void => {
  if (dyingFromFatal) return;
  if (currentTaskId !== undefined) {
    // A task is in progress — let runInPool's own handlers absorb the error
    // into the test result.
    return;
  }
  sendFatalError(err);
  setImmediate(() => process.exit(1));
};
process.on('uncaughtException', fatalExit);
process.on('unhandledRejection', fatalExit);

const handleStart = (request: Extract<WorkerRequest, { type: 'start' }>) => {
  process.env.RSTEST_WORKER_ID = String(request.workerId);
  send({ type: 'started', pid: process.pid });
};

type TaskKind = 'run' | 'collect';

const RESPONSE_TYPE: Record<TaskKind, 'runFinished' | 'collectFinished'> = {
  run: 'runFinished',
  collect: 'collectFinished',
};

const runTask = async (
  kind: TaskKind,
  request: Extract<WorkerRequest, { type: 'run' | 'collect' }>,
): Promise<void> => {
  currentTaskId = request.taskId;

  try {
    const result = await runInPool(request.options);
    send({
      type: RESPONSE_TYPE[kind],
      taskId: request.taskId,
      result: result as any,
    });
  } catch (err) {
    // runInPool's own uncaughtException handler funnels per-test errors into
    // the result; reaching this catch means the worker's internal state is
    // corrupted (setup-file or compilation failure). Reporting `fatal_error`
    // alone is not enough — without exiting, an `isolate: false` pool would
    // reuse this poisoned process for the next file.
    dyingFromFatal = true;
    sendFatalError(err);
    currentTaskId = undefined;
    setImmediate(() => process.exit(1));
    return;
  }

  currentTaskId = undefined;
  if (exitOnTaskIdle) finalizeStop();
};

const requestGracefulStop = (): void => {
  if (stopRequested) return;
  stopRequested = true;
  if (currentTaskId !== undefined) {
    // Defer the ack + exit until the task's `finally { await teardown(); }`
    // runs. PoolRunner's WORKER_STOP_TIMEOUT_MS escalates to SIGKILL if
    // teardown truly hangs, so this deferral is bounded.
    exitOnTaskIdle = true;
    return;
  }
  finalizeStop();
};

// SIGTERM shares the same shutdown path. `PoolRunner.stop` sends SIGTERM
// alongside the `stop` envelope; without this handler Node's default SIGTERM
// behavior would terminate the process immediately and skip teardown. Note
// that `setup.ts` may install a profiling-specific SIGTERM handler
// (`--cpu-prof` et al.) that runs first and preempts ours, preserving
// existing profiling semantics.
process.on('SIGTERM', requestGracefulStop);

process.on('message', (message: unknown) => {
  if (!isWorkerRequestEnvelope(message)) {
    // Not a lifecycle envelope — leave it for the rpc handler installed by
    // createForksRpcOptions to pick up via its own listener.
    return;
  }
  const request = message.request;
  switch (request.type) {
    case 'start':
      handleStart(request);
      break;
    case 'run':
      void runTask('run', request);
      break;
    case 'collect':
      void runTask('collect', request);
      break;
    case 'stop':
      requestGracefulStop();
      break;
  }
});
