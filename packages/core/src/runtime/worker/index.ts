import './setup';
import { isMainThread } from 'node:worker_threads';
import {
  isWorkerRequestEnvelope,
  serializeError,
  type WorkerRequest,
  type WorkerResponse,
  wrapWorkerResponse,
} from '../../pool/protocol';
import { ENV } from '../../utils/env';
import { channel } from './channels';
import { runInPool } from './runInPool';

const send = (response: WorkerResponse): void => {
  channel.send(wrapWorkerResponse(response));
};

let currentTaskId: number | undefined;
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

/**
 * Hand control back to Node's default uncaught-exception path. Best-effort
 * IPC delivery happens first, then **all** uncaughtException / unhandledRejection
 * listeners are cleared and the error is re-thrown on the next tick so Node's
 * built-in handler is what actually terminates the process — printing the
 * stack to stderr (forks pool: piped to the host's stderr; threads pool:
 * surfaced via `worker.on('error')`).
 *
 * Why clear *all* listeners, not just `fatalExit`: `runInPool` installs its
 * own per-task uncaughtException handler that silently absorbs errors into
 * `unhandledErrors` (see `runInPool.ts` ~ line 230). That handler is removed
 * only when the *next* `preparePool` runs, so for `isolate: true` it stays
 * installed forever after the first task. If we leave it attached, the
 * re-thrown error gets absorbed and Node's default never runs — the worker
 * neither prints a stack nor exits, and `PoolRunner.stopTimer` eventually
 * SIGTERMs it 60s later with no diagnostic info.
 *
 * Why not just `process.exit(1)`: `process.send` is async and a synchronous
 * exit drops any envelope still queued in the IPC pipe (verified to lose
 * 100% of envelopes ≥ ~100KB on macOS). Without a fallback the host sees
 * only `Worker exited unexpectedly (code=1, signal=null)` with no stack.
 */
const handOffToNodeDefault = (err: unknown): void => {
  process.removeAllListeners('uncaughtException');
  process.removeAllListeners('unhandledRejection');
  process.nextTick(() => {
    throw err;
  });
};

/**
 * Last-resort handlers. The runtime's `runInPool` registers its own
 * uncaught/unhandled handlers that capture errors thrown WHILE a test is
 * running and feed them into the test result. These bottom-of-the-stack
 * handlers fire only when no task is active (e.g., during worker bootstrap,
 * teardown after the result has been flushed, or async leak after the
 * test completes).
 */
const fatalExit = (err: unknown): void => {
  if (dyingFromFatal) return;
  if (currentTaskId !== undefined) {
    // A task is in progress — let runInPool's own handlers absorb the error
    // into the test result.
    return;
  }
  dyingFromFatal = true;
  sendFatalError(err);
  handOffToNodeDefault(err);
};
process.on('uncaughtException', fatalExit);
process.on('unhandledRejection', fatalExit);

const handleStart = (request: Extract<WorkerRequest, { type: 'start' }>) => {
  process.env[ENV.WORKER_ID] = String(request.workerId);
  send({ type: 'started', pid: process.pid });
};

type TaskKind = 'run' | 'collect';

const RESPONSE_TYPE: Record<TaskKind, 'runFinished' | 'collectFinished'> = {
  run: 'runFinished',
  collect: 'collectFinished',
};

// Skip RSS reporting for thread workers — `process.memoryUsage().rss` is
// host-wide and would mislead the gate. See rstest#1301. Read once at
// bootstrap; toggling `RSTEST_MEMORY_AWARE` mid-run is not supported (host
// samples it at pool construction too).
const MEMORY_REPORTING_ENABLED =
  isMainThread && process.env[ENV.MEMORY_AWARE] !== '0';

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
      memory: MEMORY_REPORTING_ENABLED
        ? { rss: process.memoryUsage().rss }
        : undefined,
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
    handOffToNodeDefault(err);
    return;
  }

  currentTaskId = undefined;
};

// No SIGTERM handler — the host owns termination and SIGTERM (default action:
// exit) is what gets us out. Any handler that didn't unconditionally exit
// would defeat that contract (rstest#1275). `setup.ts` may install a
// profiling-specific handler that calls `process.exit()`, which is compatible.

channel.on((message: unknown) => {
  if (!isWorkerRequestEnvelope(message)) {
    // Not a lifecycle envelope — leave it for the rpc handler installed by
    // createWorkerRpcOptions to pick up via its own listener.
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
  }
});
