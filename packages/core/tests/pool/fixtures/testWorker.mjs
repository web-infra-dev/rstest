/**
 * Minimal worker that speaks the pool protocol without Rsbuild.
 *
 * Behavior is controlled by `request.options.__testMode`:
 *   - undefined / 'normal' → immediate success result
 *   - 'slow'               → delay `__delayMs` ms then succeed
 *   - 'fatal'              → send `fatal_error` then exit(1)
 *   - 'exit-silent'        → exit(1) without any response
 *   - 'stderr-crash'       → write to stderr then exit(1)
 *   - 'stderr-large'       → write >64KB of stderr then exit(1)
 *   - 'stderr-late'        → write to stderr and exit(1) immediately
 *   - 'spawn-orphan'       → spawn a long-lived grandchild that inherits
 *                             stdio, then send result and exit normally.
 *                             Tests that `exit` (not `close`) drives the
 *                             pool lifecycle.
 *
 * Auto-detects whether it's running under `child_process.fork` (forks pool)
 * or `worker_threads.Worker` (threads pool) and routes messages over the
 * matching channel. Mirrors the channel auto-detection in the real worker
 * entry so a single fixture can drive both pool implementations.
 */

import { spawn } from 'node:child_process';
import { isMainThread, parentPort, threadId } from 'node:worker_threads';

const REQ_TAG = '__rstest_worker_request__';
const RES_TAG = '__rstest_worker_response__';

const isThreadWorker = !isMainThread && parentPort !== null;

const send = (response) => {
  const envelope = { [RES_TAG]: true, response };
  if (isThreadWorker) {
    try {
      parentPort.postMessage(envelope);
    } catch {
      // host may have terminated us already
    }
    return;
  }
  if (typeof process.send !== 'function') return;
  try {
    process.send(envelope);
  } catch {
    // channel may be closed
  }
};

const onHostMessage = (handler) => {
  if (isThreadWorker) {
    parentPort.on('message', handler);
  } else {
    process.on('message', handler);
  }
};

// Thread workers share the host `process.pid`, so use `threadId` (>=1, unique
// per spawned worker) as the per-worker id in threads mode. Forks each have
// their own pid.
const workerIdentity = isThreadWorker ? threadId : process.pid;
let assignedWorkerId = null;

let runCount = 0;

// This worker entry runs as a real .mjs and cannot import core .ts source, so
// it keeps a literal copy. MUST match getFileTaskId in
// packages/core/src/utils/helper.ts (the grammar is pinned by
// tests/utils/helper.test.ts).
const getFileTaskId = (testPath) => `file:${testPath}`;

const makeRunResult = (request, extra) => ({
  testId: getFileTaskId(request.options?.entryInfo?.testPath ?? '/test.ts'),
  testPath: request.options?.entryInfo?.testPath ?? '/test.ts',
  project: 'default',
  status: 'pass',
  name: '',
  results: [],
  // Test-only fields so the test can verify pool behavior. Under threads
  // mode this is `threadId`; under forks it is `process.pid`.
  _workerIdentity: workerIdentity,
  _workerId: assignedWorkerId,
  _runCount: ++runCount,
  ...extra,
});

const handleRun = (request) => {
  const mode = request.options?.__testMode;

  const finish = (extra) => {
    send({
      type: 'runFinished',
      taskId: request.taskId,
      result: makeRunResult(request, extra),
    });
  };

  if (mode === 'fatal') {
    send({
      type: 'fatal_error',
      error: {
        name: 'Error',
        message: 'intentional crash',
        stack: 'Error: intentional crash\n    at test-worker.mjs',
      },
    });
    // `process.exit()` inside a worker_threads Worker exits just the thread
    // (not the parent process), matching the forks behavior.
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

  if (mode === 'stderr-large') {
    const chunk = 'x'.repeat(1024) + '\n';
    for (let i = 0; i < 100; i++) {
      process.stderr.write(chunk);
    }
    process.stderr.write('STDERR_TAIL_MARKER\n');
    setTimeout(() => process.exit(1), 10);
    return;
  }

  if (mode === 'stderr-late') {
    process.stderr.write('late-stderr-marker\n');
    process.exit(1);
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

onHostMessage((message) => {
  if (!message || message[REQ_TAG] !== true) return;
  const request = message.request;

  switch (request.type) {
    case 'start':
      assignedWorkerId = request.workerId;
      send({ type: 'started', pid: workerIdentity });
      break;
    case 'run':
      handleRun(request);
      break;
    case 'collect':
      handleCollect(request);
      break;
  }
});

// No SIGTERM handler — mirrors worker/index.ts.
