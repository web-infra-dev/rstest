/**
 * Minimal worker that speaks the pool protocol without Rsbuild.
 *
 * Behavior is controlled by `request.options.__testMode`:
 *   - undefined / 'normal' → immediate success result
 *   - 'slow'               → delay `__delayMs` ms then succeed
 *   - 'fatal'              → send `fatal_error` then exit(1)
 *   - 'exit-silent'        → exit(1) without any response
 *   - 'stderr-crash'       → write to stderr then exit(1)
 *   - 'spawn-orphan'       → spawn a long-lived grandchild that inherits
 *                             stdio, then send result and exit normally.
 *                             Tests that `exit` (not `close`) drives the
 *                             pool lifecycle.
 */

import { spawn } from 'node:child_process';

const REQ_TAG = '__rstest_worker_request__';
const RES_TAG = '__rstest_worker_response__';

const send = (response) => {
  if (typeof process.send !== 'function') return;
  try {
    process.send({ [RES_TAG]: true, response });
  } catch {
    // channel may be closed
  }
};

let runCount = 0;

const makeRunResult = (request, extra) => ({
  testId: '0',
  testPath: request.options?.entryInfo?.testPath ?? '/test.ts',
  project: 'default',
  status: 'pass',
  name: '',
  results: [],
  // Test-only fields so the test can verify pool behavior.
  _workerPid: process.pid,
  _runCount: ++runCount,
  ...extra,
});

// Mirrors the real worker: track whether a task is in-flight and defer
// stop until the task completes.
let taskInFlight = false;
let exitOnTaskIdle = false;

const finalizeStop = () => {
  send({ type: 'stopped' });
  setTimeout(() => process.exit(0), 10);
};

const handleRun = (request) => {
  const mode = request.options?.__testMode;
  taskInFlight = true;

  const finish = (extra) => {
    send({
      type: 'runFinished',
      taskId: request.taskId,
      result: makeRunResult(request, extra),
    });
    taskInFlight = false;
    if (exitOnTaskIdle) finalizeStop();
  };

  if (mode === 'fatal') {
    taskInFlight = false;
    send({
      type: 'fatal_error',
      error: {
        name: 'Error',
        message: 'intentional crash',
        stack: 'Error: intentional crash\n    at test-worker.mjs',
      },
    });
    setTimeout(() => process.exit(1), 10);
    return;
  }

  if (mode === 'exit-silent') {
    process.exit(1);
    return;
  }

  if (mode === 'stderr-crash') {
    process.stderr.write('segfault at 0x0\n');
    setTimeout(() => process.exit(1), 10);
    return;
  }

  if (mode === 'spawn-orphan') {
    // Spawn a long-lived grandchild that inherits the worker's piped
    // stdout/stderr. With the old `close`-based implementation, the parent
    // host's `close` event would block until this grandchild exits (because
    // it holds the pipe FDs open). With the correct `exit`-based
    // implementation the host reclaims the slot as soon as *this* worker
    // process exits.
    const grandchild = spawn(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 30000)'],
      { stdio: 'inherit' },
    );
    // Include grandchild PID so the test can clean it up.
    finish({ _grandchildPid: grandchild.pid });
    return;
  }

  if (mode === 'slow') {
    const delay = request.options?.__delayMs ?? 500;
    const startedAt = Date.now();
    setTimeout(
      () => finish({ _startedAt: startedAt, _finishedAt: Date.now() }),
      delay,
    );
    return;
  }

  // Normal
  finish();
};

const handleCollect = (request) => {
  send({
    type: 'collectFinished',
    taskId: request.taskId,
    result: {
      tests: [],
      testPath: request.options?.entryInfo?.testPath ?? '/test.ts',
      project: 'default',
    },
  });
};

let stopRequested = false;
const requestGracefulStop = () => {
  if (stopRequested) return;
  stopRequested = true;
  if (taskInFlight) {
    // Defer until the in-flight task finishes, just like the real worker.
    exitOnTaskIdle = true;
    return;
  }
  finalizeStop();
};

process.on('message', (message) => {
  if (!message || message[REQ_TAG] !== true) return;
  const request = message.request;

  switch (request.type) {
    case 'start':
      send({ type: 'started', pid: process.pid });
      break;
    case 'run':
      handleRun(request);
      break;
    case 'collect':
      handleCollect(request);
      break;
    case 'stop':
      requestGracefulStop();
      break;
  }
});

process.on('SIGTERM', requestGracefulStop);
