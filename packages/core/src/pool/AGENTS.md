# Node worker pool

`packages/core/src/pool/` — the node-side worker pool that runs and collects test files in child processes (`forks`, the default) or worker threads (`threads`). `createPool` is the only public seam; its callers are the node executor and `rstest list`. One pool per run, one `runTests` call per project.

## Layering and data flow

- Keep the layering strict: `Pool` schedules (slots, worker ids, idle LIFO reuse); `PoolRunner` owns one worker's lifecycle state machine, its birpc transport, and task attribution; `PoolWorker` (forks/threads implementations under `workers/`) stays transport-only; `MemoryGate` defers new spawns under memory pressure.
- Entries arrive perf-sorted from the node executor; assignment is pull-based — there is no per-worker file partitioning, each entry claims the next free slot.
- All IPC must go through the tagged envelopes in `protocol.ts` (lifecycle requests/responses plus an opaque birpc passthrough) — the host silently drops untagged messages. Runner lifecycle events flow worker → birpc → `sinkToRuntimeRpc(RunnerEventSink)` → stateManager + reporters.
- Crash path: a rejected `pool.runTest` becomes a fail-status file result (`workerErrorToResult`); test cases running at crash time are synthesized as failed and replayed to reporters only — deliberately not to the state manager, to avoid double-counting.

## Key invariants

- A caller's pool slot is claimed synchronously before the first `await` in `acquireRunner`; the sequential dispatch gate in `runTests` relies on this to preserve perf-sorted enqueue order. Do not add an early `await` there.
- `crashed` is set before rejecting a task so `isUsable()` stops `releaseRunner` from recycling a poisoned runner under `isolate: false`. Symmetrically, a worker that hits an internal fatal error must exit (it sends `fatal_error`, then re-throws through Node's default handler) — otherwise `isolate: false` would reuse a poisoned process.
- The host owns termination: there is no stop handshake over IPC, and the worker must not install a SIGTERM handler that defers exit — violating this reintroduces the rstest#1275 hang.
- `MemoryGate` is forks-only — thread RSS is host-wide and collapses parallelism (rstest#1301) — and must always admit at least one worker.
- Worker ids are bounded `[1, maxWorkers]` and reused; consumers depend on `RSTEST_WORKER_ID` for resource partitioning. A slot and its id free only after the child actually exits.
- birpc's timeout is disabled: a host rpc method that never resolves hangs the worker task indefinitely.
- `buildId` threaded into the task context drives the worker-side rebuild-boundary cache flush; changing its scoping breaks `isolate: false` cross-project cache sharing (rstest#1376).

## Coupling points (change both sides)

- `WorkerRequest`/`WorkerResponse` in `protocol.ts` ↔ worker-side dispatch in `../runtime/worker/index.ts` and host-side handling in `poolRunner.ts`.
- A new `PoolWorkerKind` → `createPoolWorker`'s switch (exhaustiveness-checked) and `selectMemoryGate`.
- Node exec flags in `index.ts` ↔ the `rstestSuppressWarnings.cjs` copy list in `../../rslib.config.ts` — the `--require` path resolves relative to dist, so renaming/moving the `.cjs` needs both sides.
- Assets have two delivery paths that must both stay alive: eager on the task when host memory suffices, else lazily pulled by the worker via `rpc.getAssetsByEntry`.

## Gotchas

- Bun forces `json` IPC serialization for forks — values that only survive structured clone will not round-trip there.
- stderr attribution: the buffer resets per task on reused workers, task rejection is deferred briefly so stderr can settle, and attached stderr is truncated head+tail.
- Fork stop escalates SIGTERM → SIGKILL after a grace period; thread stop is a bare `terminate()` and `force` is a no-op.
- `minWorkers` is internal-only — a floor for retained idle runners, not a reuse cap; a pending slot waiter always wins reuse.
