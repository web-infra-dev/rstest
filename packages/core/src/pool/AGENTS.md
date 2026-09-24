# Node worker pool

`packages/core/src/pool/` — the node-side worker pool that runs and collects test files in fork-based pools (`forks` and `vmForks`) or worker threads (`threads` and `vmThreads`). `createPool` is the only public seam; its callers are the node executor and `rstest list`. One pool per run, one `runTests` call per project.

## Layering and data flow

- Keep the layering strict: `Pool` schedules (slots, worker ids, idle LIFO reuse); `PoolRunner` owns one worker's lifecycle state machine, its birpc transport, and task attribution; `PoolWorker` (forks/threads implementations under `workers/`) stays transport-only; `MemoryGate` defers new spawns under memory pressure.
- Entries arrive perf-sorted from the node executor; assignment is pull-based — there is no per-worker file partitioning, each entry claims the next free slot.
- All IPC must go through the tagged envelopes in `protocol.ts` (lifecycle requests/responses plus an opaque birpc passthrough) — the host silently drops untagged messages. Runner lifecycle events flow worker → birpc → `sinkToRuntimeRpc(RunnerEventSink)` → stateManager + reporters.
- Crash path: a rejected `pool.runTest` becomes a fail-status file result (`workerErrorToResult`); test cases running at crash time are synthesized as failed and replayed to reporters only — deliberately not to the state manager, to avoid double-counting. A write failure on a live IPC channel is never benign and lands here with no retry (rstest#1142): the host emits `error` at once, and the worker hands the error to Node's default uncaught path and exits.

## Key invariants

- Host cancellation must raise `closing` through `interrupt()`, not only through `close()`, before deferred worker task rejections reach the dispatch loop's crash-result synthesis.
- A caller's pool slot is claimed synchronously before the first `await` in `acquireRunner`; the sequential dispatch gate in `runTests` relies on this to preserve perf-sorted enqueue order. Do not add an early `await` there.
- `crashed` is set before rejecting a task so `isUsable()` stops `releaseRunner` from recycling a poisoned runner under `isolate: false`. Symmetrically, a worker that hits an internal fatal error must exit (it sends `fatal_error`, then re-throws through Node's default handler) — otherwise `isolate: false` would reuse a poisoned process.
- The host owns termination: there is no stop handshake over IPC, and workers must not install a SIGTERM handler that defers exit — violating this reintroduces the rstest#1275 hang.
- Fork test workers ignore SIGINT by a listener, not by forking detached, so they stay in the session's process group: Ctrl+C is the session's signal and the host must survive it to finalize the run; a worker killed by it would surface as a crash result during cancellation. Fork workers exit on IPC disconnect so a host that dies without stopping them leaves no orphan.
- `MemoryGate` applies only to fork-based pools — thread RSS is host-wide and collapses parallelism (rstest#1301) — and must always admit at least one worker.
- Worker ids are bounded `[1, maxWorkers]` and reused; consumers depend on `RSTEST_WORKER_ID` for resource partitioning. A slot and its id free only after the child actually exits.
- birpc's timeout is disabled: a host rpc method that never resolves hangs the worker task indefinitely.
- `buildId` threaded into the task context drives the worker-side rebuild-boundary cache flush; changing its scoping breaks `isolate: false` cross-project cache sharing (rstest#1376).
- Runner reuse is environment-matched: a worker keeps its test environment alive for its whole life under `isolate: false`, so it may only take tasks whose `environmentKey` matches. Dropping the affinity would leave persisted modules holding evaluation-time captures of a torn-down environment (rstest#767); the worker rejects a mismatched task as a file-level failure rather than swapping. The key must cover environment config and the resolved environment module/bundle identity: projects using different dependency installations cannot share a pinned environment. The key also includes the task env's raw `FORCE_COLOR`/`NO_COLOR`, because modules cached under `isolate: false` detect color from env when imported. Rstest never writes color env; the worker's own color flag arrives in task options. The `minWorkers` idle floor is likewise counted per environment. `environmentKey` is derived host-side and threaded on the task — never re-derived in the worker.

## Coupling points (change both sides)

- `applyRuntimeColors` in `../runtime/worker/color.ts` toggles the tinyrainbow instance shared with `@vitest/utils`/`@vitest/expect` through the `tinyrainbow` alias in `packages/core/rslib.config.ts`; the alias must stay for the toggle to reach diff/matcher colors.
- `WorkerRequest`/`WorkerResponse` in `protocol.ts` ↔ worker-side dispatch in `../runtime/worker/index.ts` and host-side handling in `poolRunner.ts`.
- A new `PoolWorkerKind` → `createPoolWorker`'s switch (exhaustiveness-checked) and `selectMemoryGate`.
- The `--require` path for `rstestSuppressWarnings.cjs` in `index.ts` ↔ the `.cjs` copy list in `../../rslib.config.ts` — the path resolves relative to dist, so renaming/moving the `.cjs` needs both sides.
- Assets have two delivery paths that must both stay alive: eager on the task for forks/threads when host memory suffices, else lazily pulled by the worker via `rpc.getAssetsByEntry`. Normal VM-pool runs use the lazy path so each worker can retain immutable asset bytes across fresh VM Contexts; the same `workerCacheLimit` also bounds external source and V8 compilation data. Bundle-coverage debug runs bypass that cache because every result needs its complete asset-size map. Lazy requests carry only missing asset names after the first task, and `buildId`/worker disposal invalidate the cache. Both paths pass Rspack output bytes through `prepareAssetFilesForIPC`; worker consumers must use `getAssetText` or `getAssetBuffer` rather than assuming a transport-specific value shape.

## Gotchas

- Bun forces `json` IPC serialization for forks, so `prepareAssetFilesForIPC` sends valid UTF-8 assets as strings and other bytes as tagged base64. Node forks keep `Buffer`; worker threads receive `Uint8Array` through structured clone.
- stderr attribution: the buffer resets per task on reused workers, task rejection is deferred briefly so stderr can settle, and attached stderr is truncated head+tail.
- Fork stop escalates SIGTERM → SIGKILL after a grace period; thread stop is a bare `terminate()` and `force` is a no-op.
- `minWorkers` is internal-only — a floor for retained idle runners, not a reuse cap; a pending slot waiter always wins reuse.
