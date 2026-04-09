# RFC: Replace tinypool with self-owned worker pool

**Status:** Draft
**Scope:** `@rstest/core` worker pool (`packages/core/src/pool/`) and worker entry (`packages/core/src/runtime/worker/`)
**Related research:** `.tmp-research/01-rstest-usage.md`, `02-tinypool-issues.md`, `03-vitest-migration.md`, `04-vitest-post-rewrite.md`

---

## 1. Context

### 1.1 Why replace tinypool

Three forces converge:

1. **rstest has real users blocked by tinypool bugs.** Issue [web-infra-dev/rstest#1142](https://github.com/web-infra-dev/rstest/issues/1142) — a user migrating tens of thousands of tests from Jest hits intermittent Windows `write UNKNOWN` IPC errors in tinypool ≤ 2.1.0 starting from rstest 0.9.5. The user says "this will be a hard stop for us." The current rstest fix is a runtime monkey-patch of `Tinypool.ProcessWorker.prototype.send` on backup branch `backup/fix-e2e-ci-retry-before-prune` — not merged to main because it's structurally ugly.

2. **Vitest already dropped tinypool** in [vitest-dev/vitest#8705](https://github.com/vitest-dev/vitest/pull/8705) (merged 2025-10-21, shipped in Vitest v4.0.0), authored by Ari Perkkiö — who is *also* the current tinypool maintainer. The PR body explicitly names `@rstest/core` as a reason Ari couldn't fix tinypool upstream:

   > "For the past 1-2 years, whenever we've seen Tinypool related weird errors in Vitest I've thought about rewriting Tinypool completely. However Tinypool is nowadays used by large packages like `facebook/docusaurus`, `jest-light-runner` and `@rstest/core`. Rewriting Tinypool just for Vitest's needs might break other's use cases."

   Ari also publicly stated "I'm also working on removing Tinypool from Vitest completely" ([vitest#8650 comment](https://github.com/vitest-dev/vitest/issues/8650)). Tinypool is now in maintenance mode with bus factor 1 and its primary consumer gone.

3. **rstest's current integration already has workarounds for tinypool's structural issues:**
   - `stderrCapture.ts:176` has a `HACK:` comment — tinypool pipes child-process stderr straight to the parent, bypassing rstest summary rendering. rstest reaches into `pool.threads` (tinypool internal field) to attach to `childProcess.stderr` manually.
   - `runtime/worker/index.ts:96` reads `process.__tinypool_state__.workerId` (an undocumented internal field).
   - `workerMeta.ts` implements a custom `__rstest_internal__: 'rstest'` protocol just to detect worker PID because tinypool doesn't expose spawn events cleanly.
   - Worker crash errors surface as generic `Worker exited unexpectedly` because tinypool has no structured error-upward protocol. A previous attempt (commit `3cce0420`, `patches/tinypool@2.1.0.patch`) patched tinypool directly to surface uncaughtException info — that patch sits on the backup branch and was never merged.

All three categories of hack go away once we own the pool.

### 1.2 What Vitest did, and what we learn from it

Over the 6 months following #8705, Vitest's `pool.ts` grew 297→355 lines and `poolRunner.ts` grew 274→412. The growth clusters in five categories:

- **Shutdown state machine & lifecycle correctness** — majority of post-merge work: [#9337](https://github.com/vitest-dev/vitest/pull/9337) (START_FAILURE state), [#9023](https://github.com/vitest-dev/vitest/pull/9023) (prevent writing to closed worker), [#9140](https://github.com/vitest-dev/vitest/pull/9140) (double-CTRL+C), [#9027](https://github.com/vitest-dev/vitest/pull/9027) (timeout 5s→90s).
- **Observability** — [#8994](https://github.com/vitest-dev/vitest/pull/8994) OpenTelemetry.
- **Warm reuse for `isolate: false`** — [#8915](https://github.com/vitest-dev/vitest/pull/8915), [#9349](https://github.com/vitest-dev/vitest/pull/9349).
- **Scheduling heuristics** — [#8914](https://github.com/vitest-dev/vitest/pull/8914) sort-by-project.
- **stdio capture and IPC hardening** — [#8809](https://github.com/vitest-dev/vitest/pull/8809), [#8999](https://github.com/vitest-dev/vitest/pull/8999) (`serialization: 'advanced'`).

**Key lessons for Phase 1:**

1. The biggest payoff of owning the pool is *correctness and observability*, not raw perf. Design the state machine properly from day 1 so we don't repeat Vitest's 6 months of patch cycles.
2. Vitest's state machine is the right shape — steal it: `IDLE → STARTING → STARTED | START_FAILURE → STOPPING → STOPPED` with an operation lock to serialize concurrent start/stop.
3. `serialization: 'advanced'` is the right default (rstest already uses it).
4. `Pool` / `PoolRunner` / `PoolWorker` is the right layering — Phase 1 writes it this way even though we only ship one `PoolWorker` implementation.

---

## 2. Goals and non-goals

### 2.1 Phase 1 goals

- **Drop-in replacement** for rstest's current tinypool usage. No user-facing config changes. No new user-facing features.
- **Fix these concrete bugs:**
  - rstest#1142 (Windows IPC errors during worker shutdown)
  - "Worker exited unexpectedly" with no diagnostic info (currently patched on backup branch)
  - stderr capture hack (`stderrCapture.ts` reaches into tinypool internals)
  - Dependency on `process.__tinypool_state__.workerId`
  - The ad-hoc `workerMeta.ts` protocol
- **Architectural layering** set up correctly for Phase 2 extensions (see §5).
- **Remove tinypool from `packages/core/package.json` dependencies.**
- **Parity test bar:** all existing unit tests + e2e tests pass. No new flakes.

### 2.2 Phase 1 non-goals

- No new public config options.
- No warm pool / worker prewarming.
- No task-level runtime / isolate overrides (fields reserved, behavior is pool-level).
- No OpenTelemetry instrumentation.
- No `--detect-async-leaks` or similar new features.
- No scheduling improvements beyond what already exists.
- No browser mode integration.
- No threads or VM pool support.
- No performance benchmarking as acceptance criteria — correctness parity is the bar.

### 2.3 Non-goals across all phases

The following will **never** be implemented in any phase, and should be explicitly rejected if raised:

- **VM pool variants** (`vmForks`, `vmThreads`) — these exist in Vitest for legacy VM context sandboxing, which rstest doesn't need (Rsbuild + child_process fork already provides sufficient isolation).

---

## 3. Current state snapshot (as of `main` at RFC time)

### 3.1 Current tinypool usage surface

4 import sites:

| File | Line | Usage |
|---|---|---|
| `packages/core/src/pool/forks.ts` | 5 | `import { type Options, Tinypool } from 'tinypool'` — the only instantiation |
| `packages/core/src/pool/stderrCapture.ts` | 2 | `import type { Tinypool } from 'tinypool'` — type only |
| `packages/core/src/runtime/worker/rpc.ts` | 2 | `import type { TinypoolWorkerMessage } from 'tinypool'` — to filter internal messages |
| `packages/core/src/runtime/worker/index.ts` | 96 | `process.__tinypool_state__.workerId` — internal field access |

Config options currently passed to Tinypool (`forks.ts:94-104`):

- `runtime: 'child_process'` — always forks, never threads
- `filename: ./worker.js` — the built worker entry
- `env`, `execArgv` — forwarded from user config
- `maxThreads` / `minThreads` — from `poolOptions.maxWorkers` / `minWorkers`
- `concurrentTasksPerWorker: 1` — one task per worker at a time
- `isolateWorkers: isolate` — fresh worker per task when true
- `serialization: 'advanced'` — rich object support

### 3.2 Current scheduling behavior

- One test file = one task (no batching, no sharding).
- All entries dispatched in parallel via `Promise.all(entries.map(pool.runTest))` — no sequencer logic.
- One shared pool per `RstestContext`, reused for both run and collect phases.
- `concurrentTasksPerWorker: 1` — each worker handles one file at a time.
- `isolateWorkers: isolate` — when `isolate: true` (default), a fresh worker is spawned per task.

### 3.3 Current RPC architecture

- **birpc** with `timeout: -1` (disabled) over a tinypool `channel`.
- Worker-to-host RPC (`RuntimeRPC`): `resolveSnapshotPath`, `onConsoleLog`, `onTestCaseResult`, etc.
- Host-to-worker RPC (`ServerRPC`): exists but minimally used.
- Task delivery: via `pool.run(options, { channel })` — tinypool-specific API.
- Worker message filtering: `TinypoolWorkerMessage` messages filtered out as tinypool internal signaling.
- Worker meta protocol: `{ __rstest_internal__: 'rstest', type: 'rstest:worker-meta', ... }` — sent from worker on startup so host can bind stderr capture to the right PID.

### 3.4 Current config surface (user-facing, MUST NOT CHANGE in Phase 1)

`packages/core/src/types/config.ts:17-28`:

```typescript
export type RstestPoolType = 'forks';

export type RstestPoolOptions = {
  type?: RstestPoolType;
  maxWorkers?: number | string;
  minWorkers?: number | string;
  execArgv?: string[];
};
```

**Decision:** `minWorkers` stays, not marked deprecated. `RstestPoolType` stays as literal `'forks'`.

---

## 4. Phase 1: Drop-in replacement

### 4.1 Layering and responsibilities

Three-layer split, borrowed from Vitest's #8705:

```
Pool          — queue, scheduling, max/min worker clamp, cancel/close entry
  │
PoolRunner    — per-worker lifecycle state machine, birpc wiring, crash
  │             attribution, task result routing
  │
PoolWorker    — transport abstraction: spawn/stop the underlying resource,
                pipe stdio, frame messages (interface only; one impl in Phase 1)
```

**Strict rules:**

- `Pool` and `PoolRunner` must not import any concrete `PoolWorker` implementation. All dependencies flow through the interface.
- `PoolRunner` owns the state machine; `PoolWorker` owns the transport. They must not bleed into each other.
- `Pool` owns task scheduling and worker accounting. It does not know about IPC, birpc, or state transitions.

### 4.2 Module layout

New files under `packages/core/src/pool/`:

```
packages/core/src/pool/
├── index.ts                    # createPool — public entry (signature preserved)
├── pool.ts                     # Pool class
├── poolRunner.ts               # PoolRunner class
├── poolWorker.ts               # PoolWorker interface
├── protocol.ts                 # WorkerRequest / WorkerResponse / Envelope types
├── types.ts                    # PoolTask / PoolOptions / PoolTaskResult
├── workers/
│   ├── index.ts                # createPoolWorker factory
│   └── forksPoolWorker.ts      # ForksPoolWorker — the only Phase 1 implementation
└── rstestSuppressWarnings.cjs  # UNCHANGED
```

Files to delete:

- `packages/core/src/pool/forks.ts` → replaced by `pool.ts` + `workers/forksPoolWorker.ts`
- `packages/core/src/pool/stderrCapture.ts` → absorbed into `ForksPoolWorker`
- `packages/core/src/pool/workerMeta.ts` → absorbed into `protocol.ts` (the `started` response carries `pid`)

Worker entry changes:

- `packages/core/src/runtime/worker/index.ts` — rewritten as a lifecycle bootstrap (message loop, fatal error hooks). Still the Rslib build target; no Rslib config changes.
- `packages/core/src/runtime/worker/runInPool.ts` — NEW, contains the existing `runInPool` body moved out of `index.ts`.
- `packages/core/src/runtime/worker/rpc.ts` — drops `TinypoolWorkerMessage` import, uses Envelope discriminators.

### 4.3 `PoolWorker` interface (the abstract contract)

Minimal shape, deliberately transport-agnostic so browser and threads impls in Phase 2 fit without refactor:

```typescript
export interface PoolWorker {
  readonly name: string
  start(): Promise<void>
  stop(options?: { force?: boolean }): Promise<void>
  /** Framed lifecycle message. */
  send(request: WorkerRequest): void
  /** Raw envelope path, used by birpc RPC passthrough. */
  sendRaw(envelope: Envelope): void
  on(event: 'message' | 'error' | 'exit', listener: (...args: any[]) => void): void
  off(event: string, listener: (...args: any[]) => void): void
  /** For browsers this decodes postMessage; for forks with advanced serialization, pass-through. */
  deserialize(data: unknown): unknown
}
```

What it owns: spawn/stop the underlying resource, stdio capture, signal handling, message framing.
What it does NOT own: state machine, birpc, scheduling, task attribution.

### 4.4 Protocol shape

Three discriminator-tagged envelope kinds share the same IPC channel:

- `__rstest_worker_request__` — host → worker lifecycle (`start`, `run`, `collect`, `stop`, reserved `cancel`).
- `__rstest_worker_response__` — worker → host lifecycle (`started` with `pid`, `runFinished`, `collectFinished`, `stopped`, **`fatal_error`**).
- `__rstest_rpc__` — birpc passthrough.

**Key design choices:**

- Every message carries exactly one discriminator — no ambiguity when classifying inbound traffic.
- `started` carries `pid` so stderr capture binds without a separate `workerMeta` protocol.
- `fatal_error` is the structured replacement for `patches/tinypool@2.1.0.patch`. Worker registers `uncaughtException` / `unhandledRejection` handlers; on crash it serializes the error + current phase + current taskId and calls `process.send` before exiting. Host attributes the failure to the correct task instead of surfacing a generic `Worker exited unexpectedly`.
- Lifecycle and RPC share the same channel in Phase 1. Discriminators mean Phase 3 can split event traffic (console logs, per-test-case events) onto a faster path without a protocol break.
- `cancel` is reserved but unused in Phase 1; cancellation is implemented by calling `PoolWorker.stop({ force: true })`.

### 4.5 `PoolRunner` state machine

Borrowed from Vitest, proven over 6 months of fix PRs:

```
IDLE ──start()──▶ STARTING ──ack──▶ STARTED ──stop()──▶ STOPPING ──exit──▶ STOPPED
                      │                 │                  ▲
                      └── timeout ─▶ START_FAILURE ────────┘
```

**Invariants:**

- An `_operationLock` serializes concurrent `start()` / `stop()` calls so the state machine never sees interleaved transitions.
- `runTask` throws if state is not `STARTED`.
- Any task `send()` after state has moved to `STOPPING` is silently dropped (Vitest [#9023](https://github.com/vitest-dev/vitest/pull/9023)).
- Expected exits (triggered from our own `stop()`) must not trigger the crash-attribution path; `_handleExit` checks state before rejecting pending tasks.
- On `fatal_error`, attribute to `currentTaskId` (reject that task's promise with the deserialized error + stderr buffer).
- On unexpected exit without preceding `fatal_error`, enrich the generic exit error with the captured stderr buffer.

**Timeouts:**

- `WORKER_START_TIMEOUT_MS = 90_000` (matches Vitest [#9027](https://github.com/vitest-dev/vitest/pull/9027) — their 5s default caused false failures in large projects).
- `WORKER_STOP_TIMEOUT_MS = 60_000` — after this the runner escalates to `stop({ force: true })`.

### 4.6 `ForksPoolWorker` behavior

The only Phase 1 implementation. Uses `node:child_process.fork` with `serialization: 'advanced'` and `stdio: ['ignore', 'pipe', 'pipe', 'ipc']`.

**Responsibilities it absorbs from the current code:**

- Stdio piping to the host logger (replaces the HACK in `stderrCapture.ts`).
- Local stderr buffering (capped at 1 MB) so `PoolRunner` can enrich crash errors.
- SIGTERM → SIGKILL fallback (`SIGKILL_TIMEOUT = 500 ms`) in the force path.
- Swallowing benign shutdown errors on `send`: `ERR_IPC_CHANNEL_CLOSED`, `EPIPE`, `ECONNRESET`, Windows `write UNKNOWN`, `channel closed`. This is the direct fix for rstest#1142.

**Responsibilities it does NOT have:**

- No state machine — that's `PoolRunner`.
- No birpc — that's `PoolRunner`.
- No task tracking — that's `PoolRunner`.

### 4.7 `Pool` scheduling behavior

Phase 1 scheduling is deliberately minimal — matches current rstest behavior:

- No internal queue; `pool.run(task)` dispatches immediately up to `maxWorkers`.
- A simple slot waiter blocks `run()` calls when `activeTaskCount >= maxWorkers`.
- When `isolate: true` (default): spawn a fresh `PoolRunner` per task. Stop it in the background after the task finishes (non-blocking).
- When `isolate: false`: reuse idle `PoolRunner`s up to `maxWorkers`. Close them on `pool.close()`.
- `minWorkers` is treated as a lower bound on retained idle runners (meaningful only for `isolate: false`). No eager pre-spawning — lazy spawn on first demand, matching tinypool's observed behavior.
- `cancel()`: first call sends graceful stop to all runners; second call escalates to force. Sets `_isClosing` so further `run()` calls throw.
- `close()`: graceful stop of all runners, used on normal shutdown.

**Implementation constraint:** `Pool` receives `PoolTask` objects and delegates worker creation to the `createPoolWorker(task, options)` factory. It never instantiates `ForksPoolWorker` directly.

### 4.8 `createPoolWorker` factory

Pure switch over `task.worker`. In Phase 1 there's exactly one case (`'forks'`) plus an exhaustiveness check:

```typescript
export function createPoolWorker(task: PoolTask, options: PoolOptions): PoolWorker {
  switch (task.worker) {
    case 'forks':
      return new ForksPoolWorker({ /* merged task + pool options */ })
    default: {
      const _exhaustive: never = task.worker
      throw new Error(`Unknown pool worker: ${_exhaustive}`)
    }
  }
}
```

This is where the Phase 2 acceptance criterion lands: adding threads support means adding a `case 'threads':` and extending the `PoolTask['worker']` union. Nothing else.

### 4.9 `PoolTask` reserved fields

`PoolTask` carries reserved-but-unused fields so that Phase 2 / Phase 3 can wire them without touching the interface or the types file:

- `execArgv?: string[]` — per-task Node flags. Phase 1: unused, falls back to pool-level.
- `env?: Record<string, string>` — per-task env. Phase 1: unused.
- `isolate?: boolean` — per-task isolation override. Phase 1: unused.
- `affinity?: string` — sticky-worker hint for smart scheduling. Phase 1: unused.
- `worker: 'forks'` — transport discriminator. Phase 2 expands to `'forks' | 'threads' | 'browser'`.

These are live type fields, not comments. Phase 1 sets them when constructing tasks but the factory ignores the overrides — behavior is pool-level.

### 4.10 `createPool` entry point

`packages/core/src/pool/index.ts` keeps its existing public signature. It:

1. Translates `RstestPoolOptions` → `PoolOptions`.
2. Applies the `execArgv` filter currently at `src/pool/index.ts:171-175` (drops `--prof`, `--title`, etc.).
3. Constructs a `Pool`.
4. Returns an object with `runTest` / `collectTests` / `close` methods that wrap `pool.run(task)` / `pool.close()`.

Callers in `packages/core/src/core/` do not need to change.

### 4.11 Migration strategy

**Single-cutover, NOT side-by-side.** Implement all new files, delete old files, remove `tinypool` from dependencies, all in one changeset. Side-by-side adds complexity without buying meaningful safety since the user works on a feature branch.

Steps:

1. Implement new files in place.
2. Delete `forks.ts`, `stderrCapture.ts`, `workerMeta.ts`.
3. Remove `tinypool` from `packages/core/package.json`.
4. Rebuild `@rstest/core` per project conventions.
5. Run `pnpm --filter @rstest/core test` — must pass.
6. Run `pnpm e2e` — must pass.

### 4.12 Testing strategy

**Parity bar:** all existing `packages/core/tests/` + all existing `e2e/` pass.

**New targeted tests for Phase 1 bug fixes:**

1. **Graceful shutdown with pending IPC writes.** Worker does `process.exit(0)` mid-send. Host does not throw; in-flight task rejects with meaningful error.
2. **Fatal error attribution.** Test body does `setImmediate(() => { throw new Error('boom') })`. Host receives `fatal_error`, attributes to the correct test file, preserves stack trace, includes stderr buffer in final output.
3. **Double-cancel force path.** Worker stuck in `while (true) {}`. First cancel times out gracefully, second cancel SIGKILLs immediately.
4. **Isolate mode respawn.** `isolate: true` runs each task on a distinct PID.
5. **Non-isolate reuse.** `isolate: false` runs multiple tasks on the same PID.
6. **Windows IPC resilience** (if CI runs on Windows): `ForksPoolWorker.send` swallows `ERR_IPC_CHANNEL_CLOSED` / `write UNKNOWN` without throwing.

### 4.13 Things to watch out for

- **birpc timeout**: keep `timeout: -1`. Some operations are legitimately long-running.
- **Serialization**: keep `serialization: 'advanced'`. rstest config round-tripping depends on it.
- **execArgv filter**: preserve the current drop list.
- **`process.env.RSTEST_WORKER_ID`**: assigned by the host in the spawn `env`, not read from any tinypool internal. The worker reads it from `process.env` / the `run` message options.
- **Global setup**: `src/core/globalSetup.ts:24` passes `runtime: 'child_process'` to a second Tinypool instance just for global setup hooks. See Open Question 1.

---

## 5. Phase 2: reserved interfaces (no implementation)

Phase 2 targets are **browser mode unification** and **threads support**. Neither is implemented in Phase 1, but Phase 1's abstraction boundaries must be drawn so that adding them later does not require refactoring `pool.ts`, `poolRunner.ts`, or `poolWorker.ts`.

**Reservation mechanism:** real abstraction + single implementation + zero dead code. No comment markers, no TS type placeholders with `never`, no disabled branches. Phase 2 adds behavior by adding files, not by enabling code that was already written.

### 5.1 Threads support — acceptance criteria

Adding `worker_threads` support MUST be achievable by:

1. Creating `packages/core/src/pool/workers/threadsPoolWorker.ts` that implements `PoolWorker` using `node:worker_threads`.
2. Adding `case 'threads':` in `packages/core/src/pool/workers/index.ts`.
3. Extending `PoolTask['worker']` from `'forks'` to `'forks' | 'threads'` in `packages/core/src/pool/types.ts`.
4. Extending `RstestPoolType` from `'forks'` to `'forks' | 'threads'` in `packages/core/src/types/config.ts`.
5. Adjusting the worker entry (`packages/core/src/runtime/worker/index.ts`) to pick between `process.send` / `process.on('message')` and `parentPort` at runtime. Ideally a single file gated by `typeof process.send === 'function'`, not a separate entry.

**Zero changes** required to: `pool.ts`, `poolRunner.ts`, `poolWorker.ts`, `protocol.ts`.

If any of those need changes when implementing threads, the abstraction is wrong and must be fixed in Phase 1 before declaring it done.

### 5.2 Browser mode unification — acceptance criteria

`@rstest/browser` currently has its own independent scheduler in `packages/browser/src/hostController.ts` + `dispatchRouter.ts` + `sessionRegistry.ts` + `concurrency.ts`. Phase 3 collapses these into a `BrowserPoolWorker` that implements `PoolWorker`.

For this to be possible:

1. `PoolWorker` interface MUST NOT assume the underlying transport is a Node child_process. No `ChildProcess` in method signatures, no fork-specific types leaking.
2. `PoolRunner` MUST NOT reference `ChildProcess` or any `node:child_process` type.
3. The `sendRaw(envelope)` path (used by birpc) must work for any transport, including `postMessage`.
4. `PoolTask['worker']` union expands to include `'browser'`.
5. `createPoolWorker` factory handles the new case.

Phase 1's `PoolWorker` interface is deliberately kept to the minimal surface above for exactly this reason. The browser worker wraps a Playwright page and communicates via `postMessage`; that must fit.

### 5.3 Task-level overrides

Reserved fields on `PoolTask` (§4.9). Phase 2 wires them through the factory and scheduler. Phase 1 only types them.

### 5.4 Protocol discriminators — reserved for split-channel

All messages in Phase 1 travel over the same IPC channel. The `Envelope` discriminators (`__rstest_worker_request__`, `__rstest_worker_response__`, `__rstest_rpc__`) mean Phase 3 can split event traffic (console logs, per-test-case events) onto a separate fast path without breaking the protocol.

No Phase 1 work beyond ensuring every message carries exactly one discriminator.

### 5.5 `WorkerPhase` field — reserved for telemetry

The worker tracks `currentPhase: 'idle' | 'loading' | 'collecting' | 'running'` for crash attribution in `fatal_error` messages. This same field is the foundation for Phase 3 OpenTelemetry spans and async-leak detection. Phase 1 uses it only in `fatal_error` messages — no other consumers, no telemetry scaffolding.

---

## 6. Phase 3: future work (reference only)

Not to be implemented in Phase 1. Do NOT add placeholder code, TODO comments, or dead-code branches for these.

### 6.1 Architecture moves (rstest-unique)

- **Browser mode unification** — `@rstest/browser` implements `PoolWorker`, replaces its independent scheduler. rstest's biggest architectural differentiator from Vitest.
- **Smart scheduling via Rspack module graph:**
  - Affinity clustering by Jaccard similarity on dep sets → cluster-adjacent file ordering.
  - Watch mode impact analysis via reverse index → precise "what to rerun" on file change.
  - LPT (longest processing time) scheduling using dep count + history duration as weight.
  - Critical-path ordering for minimized makespan.
- **Rsbuild watch mode incremental worker reuse** — keep worker processes alive across watch reruns, push HMR chunks via birpc, workers reset module cache instead of exiting.
- **V8 code cache for `worker.js`** — precompile + cache bytecode. rstest's `dist/worker.js` is a static artifact, which is a structural advantage over Vitest.

### 6.2 Optimizations borrowed from Vitest post-rewrite

- **Per-environment warm reuse for `isolate: false`** — Vitest [#8915](https://github.com/vitest-dev/vitest/pull/8915). Cross-file jsdom reuse.
- **Sequencer sort by project + environment** — Vitest [#8914](https://github.com/vitest-dev/vitest/pull/8914). Makes warm reuse actually hit.
- **`preParse` via `rstest list`** — when user passes `.only` / `-t` / line filter, AST-collect on host before spawning workers. Vitest [#10070](https://github.com/vitest-dev/vitest/pull/10070). rstest has a head start because `rstest list` already exists.
- **Event channel split from RPC channel** — hot-path messages (console, test events) bypass birpc. Envelope discriminators in Phase 1 make this a non-breaking change.

### 6.3 Observability

- **OpenTelemetry spans** — `rstest.worker.{start,run,collect,stop}` hierarchy, OTEL carrier piggybacked on `WorkerRequest`. Vitest [#8994](https://github.com/vitest-dev/vitest/pull/8994) is the reference implementation.
- **`--detect-async-leaks`** — `async_hooks` tracking at worker level. Vitest [#9528](https://github.com/vitest-dev/vitest/pull/9528) closed a 3-year-old issue with this.
- **Per-worker memory/CPU metrics + "heaviest files" reporter.**

### 6.4 User-facing features

- **Per-task `execArgv` as user API** — e.g. `test.execArgv(['--expose-gc'])` per test file.
- **Per-project isolate mixing** — different projects can have different isolate settings in a workspace run.
- **Cross-project unified `maxWorkers`** — single resource cap across workspace projects.
- **Task-level cancellation** — cancel an in-flight test file without killing the worker.

### 6.5 Potentially ambiguous (conditional on user demand)

- **`worker_threads` as a user-facing option.** Phase 2 reserves the interface; actually shipping threads as a documented option is a Phase 3 call and should be driven by concrete user demand, not "because Vitest has it."

### 6.6 Explicitly rejected (not even Phase 3)

- **VM pool variants** (`vmForks`, `vmThreads`) — rstest's architecture (Rsbuild + child_process fork) doesn't need VM context sandboxing.

---

## 7. Open questions for implementation

Deliberate design choices left for the implementer, with recommended defaults:

1. **Should `globalSetup.ts` also use the new Pool?** Currently it has its own Tinypool instance. Options:
   - (a) Use the new Pool — requires exposing it more formally, adds coupling.
   - (b) Use a direct `child_process.fork` — much simpler for a single-shot setup. **Recommended.**
   - (c) Keep it as-is but swap Tinypool for the new Pool — fine but requires Pool to accept single-task-then-close usage.

2. **birpc lifecycle on runner stop.** When a runner stops mid-task, should pending birpc calls reject with a specific error or silently drop? **Recommended:** reject with `Error('Pool runner stopped')` so users see why their snapshot write / RPC call failed.

3. **stderr capture buffer size.** `ForksPoolWorker` caps captured stderr at 1 MB. **Recommended:** 1 MB module constant, revisit if users report truncated crash output.

4. **Start timeout value.** 90 seconds (Vitest post-#9027 default). **Recommended:** start with 90s as a module constant, revisit if large projects hit it.

5. **Pool concurrency when `isolate: false`.** Eager pre-spawn up to `maxWorkers`, or lazy? **Recommended:** lazy — matches tinypool's observed behavior and avoids wasting resources for small test runs.

6. **Where does `sendRaw(envelope)` live on `PoolWorker`?** It's on the interface so birpc RPC path works, but it leaks the envelope type to the contract. **Recommended:** keep it on the interface — envelope is part of the abstract protocol, not a fork-specific detail. Browser / threads need the same path.

---

## 8. Appendix: references

### Research documents

- `.tmp-research/01-rstest-usage.md` — complete inventory of rstest's current tinypool integration surface, file-by-file.
- `.tmp-research/02-tinypool-issues.md` — catalog of tinypool's known bugs and architectural constraints with 40+ issue URLs.
- `.tmp-research/03-vitest-migration.md` — why Vitest dropped tinypool, replacement architecture, quoted motivations.
- `.tmp-research/04-vitest-post-rewrite.md` — what Vitest did in pool after the rewrite merged, lessons for rstest.

### Files that will change in Phase 1

| File | Action |
|---|---|
| `packages/core/src/pool/forks.ts` | DELETE |
| `packages/core/src/pool/stderrCapture.ts` | DELETE |
| `packages/core/src/pool/workerMeta.ts` | DELETE |
| `packages/core/src/pool/index.ts` | REWRITE — `createPool` uses new `Pool` |
| `packages/core/src/runtime/worker/index.ts` | REWRITE — lifecycle entry |
| `packages/core/src/runtime/worker/rpc.ts` | UPDATE — Envelope discriminators, drop `TinypoolWorkerMessage` |
| `packages/core/src/core/globalSetup.ts` | UPDATE — replace Tinypool usage (see Open Question 1) |
| `packages/core/package.json` | REMOVE `tinypool` from dependencies |

### Files added in Phase 1

| File | Purpose |
|---|---|
| `packages/core/src/pool/pool.ts` | `Pool` class |
| `packages/core/src/pool/poolRunner.ts` | `PoolRunner` class |
| `packages/core/src/pool/poolWorker.ts` | `PoolWorker` interface |
| `packages/core/src/pool/protocol.ts` | Envelope / WorkerRequest / WorkerResponse types + guards |
| `packages/core/src/pool/types.ts` | `PoolTask` / `PoolOptions` / `PoolTaskResult` |
| `packages/core/src/pool/workers/index.ts` | `createPoolWorker` factory |
| `packages/core/src/pool/workers/forksPoolWorker.ts` | `ForksPoolWorker` implementation |
| `packages/core/src/runtime/worker/runInPool.ts` | Existing `runInPool` logic extracted |

### Vitest PRs referenced as implementation models

- [vitest#8705](https://github.com/vitest-dev/vitest/pull/8705) — the rewrite itself; blueprint for the abstraction layering
- [vitest#9337](https://github.com/vitest-dev/vitest/pull/9337) — `START_FAILURE` state
- [vitest#9023](https://github.com/vitest-dev/vitest/pull/9023) — prevent writing to closed worker (state-guarded `post`)
- [vitest#9140](https://github.com/vitest-dev/vitest/pull/9140) — double-CTRL+C force exit semantics
- [vitest#9027](https://github.com/vitest-dev/vitest/pull/9027) — start timeout 5s→90s
- [vitest#8999](https://github.com/vitest-dev/vitest/pull/8999) — `serialization: 'advanced'` simplification
- [vitest#8809](https://github.com/vitest-dev/vitest/pull/8809) — stdio piping to logger

### rstest issues and PRs this solves

- [web-infra-dev/rstest#1142](https://github.com/web-infra-dev/rstest/issues/1142) — Windows `write UNKNOWN` from tinypool (blocker for a real user)
- [web-infra-dev/rstest#1144](https://github.com/web-infra-dev/rstest/pull/1144) — current stopgap (monkey-patch), superseded by Phase 1
- Commit `3cce0420` + `patches/tinypool@2.1.0.patch` on `backup/fix-e2e-ci-retry-before-prune` — structured crash reporting, superseded by the Phase 1 `fatal_error` protocol
