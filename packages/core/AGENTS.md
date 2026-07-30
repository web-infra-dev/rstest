# @rstest/core

Core testing framework for Rstest.

## Subsystem map

- `src/cli/` — CLI parsing and the CLI → config merge
- `src/core/` — run orchestration: Rsbuild integration, executor seam, scheduling, state management
- `src/core/browser/` — core-side browser-mode detail (load boundary, browser-side run planning, pre-cycle globalSetup stage)
- `src/core/plugins/` — Rsbuild/Rspack plugins (mock seam, externals, entry assembly)
- `src/runtime/` — test-side runtime: expect, spy, fakeTimers, fixtures, runner, worker entry
- `src/reporter/` — output reporters
- `src/pool/` — node worker pool; read `src/pool/AGENTS.md` before touching the cross-process contract
- `src/coverage/` — coverage integration; read `src/coverage/AGENTS.md` before touching the cross-package contract
- `src/types/`, `src/utils/` — shared types and utilities

## Executor contract (node + browser isomorphism)

Core owns the run-cycle contract shared by the node pool and `@rstest/browser`:

- `finalizeRunCycle` is the single finalize implementation for node-only, browser-only, and mixed runs, on both commands: it reduces each executor's `ExecutorCycleOutcome` into the run verdict (merged results, coverage merge + report, reporter `onTestRunEnd`, exit code, bail message). A non-watch run exits through it exactly once; a watch run passes through it once per cycle. A cycle is the only thing that may write the exit code, with the one exception a cycle cannot express: a launch that opened no session at all (see below).
- `RunnerEventSink` is the single event pump for runner lifecycle events on both transports (node pool RPC and browser dispatch). One sink per project, bound to that project's `normalizedConfig`, feeding `stateManager` and reporters. No direct reporter/`stateManager` fanout anywhere else.
- `executorCapabilities` declares the per-executor disposition (`supported` / `ignored-warn` / `error` / `stripped`) of every `RuntimeConfig` field. Adding a field without a row is a compile error; the browser wire projection (`projectRuntimeConfig`) keeps its own hand-written field list, held in lockstep by `tests/core/executorCapabilities.test.ts`.

## Cross-cutting invariants

Contracts between modules or processes — not readable from any single file.

### Run cycle (`src/core`)

- Exit codes never downgrade: a later zero must not clear a prior non-zero.
- `stateManager` reset is core-owned (top of a non-watch run, or `prepareWatchCycleState` ahead of every watch cycle, a session's first included) — executors never reset it, so bail reads stay cycle-scoped even where two executors' first cycles bracket one startup. The snapshot summary is the one half a first cycle keeps, because the update-snapshot shortcut reads whatever the last cycle produced and the browser's first cycle would otherwise clear what the node's just left.
- `@rstest/browser` is version-locked to core and loaded through the core-owned `BrowserHostModule` contract; the browser package constrains its exports against it via `satisfies`.
- Reporter output is sorted by `testPath`, deliberately decoupled from the perf-first execution order (failed-first, then longest-processing-time). Don't "fix" one by changing the other.

### Watch mode

- Cycle-scoped watch support is the default and carries no marker: every feature is expected to hold under `rstest watch`, so only the two exceptions declare themselves — explicit rejection before anything runs, and documented degradation. A feature that misbehaves in watch without one of those markers is a bug to fix, not an undeclared stance.
- Reject only when watch semantics are undefinable (an inherently one-shot concept), never merely unimplemented — and a rejected option must stay unreachable from every other config layer (config file, plugin hooks).
- A degradation counts only when marked twice, for the two audiences that would otherwise misread it: in code at the site that skips the work, so the next reader of that branch does not take it for a bug; and where the user meets it — a runtime message at the point of use, or the en/zh website docs when the run stays silent. A degradation neither audience can find is a bug, not a stance.
- Browser projects' `globalSetup` never running in watch is a gap to close, not a design, even though the code reads as deliberate (the stage is wired only into the non-watch branch of the one assembly). Closing it must also remove the docs sentence declaring it.
- The node watch trigger holding its dev-compile hook for the whole cycle — and so losing test files created or deleted in that window — is a gap to close too, not a degradation, so it carries no user-facing marker: there is no stance to declare, only an unclosed one. Closing it means resolving the affected scope inside the hook and handing it to the cycle the way the browser transport already does, so the one destructive stats pull still happens once per compile. Anything short of that (a per-executor queue, a shorter cycle) leaves the window open.

### Browser orchestration (`src/core/browser`)

- `src/core/runTests.ts` stays a coarse orchestrator — split projects → planner resolve → construct the executors the plan calls for → drive them → finalize. Every run shape walks that one assembly: node-only, browser-only, and mixed differ only in which executors the plan produced, never in which branch built them. Planning is core-owned and lives in `src/core/planner.ts`, never inside an executor: resolving the planner is the run's init barrier (the node `modifyRstestConfig` hooks fire, the browser's fire too where the plan may depend on them — inside a files-only discovery boot — and the plan is read while it is built), so no executor can be constructed against a plan that is still moving, and "which executors does this run need" is answerable before any of them exists. The orchestrator holds one planner, never a pair to keep in step: the browser-side classification and discovery (`src/core/browser/runPlanner.ts`) is constructed and spent inside `createRunPlanner`, which is what keeps its once-only state — which environments already applied their hooks, whether the discovery boot has run — from ever being observable half-applied. Browser-mode detail lives under `src/core/browser/`, behind the `BrowserHostModule` load boundary in `src/core/browser/loader.ts`, never inline in the orchestrator.
- No orchestrator branch breaks executor isomorphism any more; the one cost that used to justify one — the cold-start gate — is a planner condition instead. A run with zero node projects must never boot a node Rsbuild instance, and the planner enforces that by skipping `prepareRsbuild`/`initConfigs` and returning no `nodeBuild`; the orchestrator only follows that answer, constructing a node executor exactly when a build came back. So the gate has to be pinned inside the planner (`tests/core/planner.test.ts` spies on `prepareRsbuild`), not at a call site the orchestrator could delete. Constructing a `NodeExecutor` is not what the gate saves — it allocates closures and nothing else, its dev server and worker pool are lazy, and its `init` is a no-op — so re-deriving "is this browser-only?" in `runTests` to skip work is both unnecessary and the shape the regression comes back in: a branch above `createRunPlanner` reintroduces a second assembly, and a branch below it can only disagree with the plan.
- Watch is one core-owned loop for every executor and every trigger (`src/core/watchSession.ts`): an executor signals through `TestExecutor.onInvalidate` having already resolved its scope, and core answers with reset → `runCycle` → `finalizeRunCycle` → next trace buffer → ready banner. Cycles are queued, so two can never interleave on the shared `stateManager`; a transport whose new trigger supersedes its own in-flight work cancels it as it signals the replacement, so the queue never makes the user wait out a stale run. A burst folds into one queued cycle instead of appending, but only among triggers of the same kind asking the same thing, because a fold unions file lists and nothing else: applying one kind's state to another's files is how `u`'s snapshot-update flag would reach files no `u` selected. `t`/`p` therefore fold with nothing at all — the pattern and filter they bind live on `context`, outside the options a fold can see, so two of them are different requests with identical options. The queue is what enforces that ordering, not the transport awaiting the callback: a trigger raised from a bundler's dev-compile hook must let that hook return, because the bundler keeps no watcher attached while it is pending and a test file created or deleted during the cycle is then never noticed at all. The browser host complies. The node executor does not yet: its cycle pulls the affected-entry diff from the dev server, and the pull advances the baseline it diffs against, so a compile's changes are consumable exactly once and holding the hook is the only thing keeping a second compile from landing against the same baseline before the first one's changes are consumed. Signal and return there and a single pull takes two compiles' changes while the other cycle diffs a baseline already past them, reporting "no test files need re-run" for a real edit. It keeps the await, and the dropped files with it — the tracked gap above, not a second contract. Which cycle consumes a compile's changes is a separate question the hook does not settle: a cycle already queued ahead of the rebuild's can, and the fold predicate records that as an accepted cost. A trigger that resolves to no work must not signal — a cycle that runs nothing reports "no test files need re-run", which a scope simply missing that executor's files should not print.
- Node run resources come up before the browser **launch**, not before the browser executor is loaded, and the difference is deliberate in watch. Loading the executor validates its config and can exit the process on a version mismatch, so it lands ahead of node env-dependency validation there; what must never happen — a browser left mid-launch by a missing node test environment — is governed by the first browser cycle, which stays deferred until the node resources have settled. The load cannot simply move later: the shared teardown and the stdin owner both close over that executor and both must exist before either side's first cycle, so reordering the load to tidy up which validation error prints first has to move them too.
- A watch run whose launch opened no session (the browser host found no test files, or failed before its runtime came up) has no trigger that can ever fire, so it must not print the ready banner — nothing could answer it. Its exit code is the one a cycle cannot carry, so it stays a host-side launch-path write; the process itself keeps running on the CLI's config-restart watcher.
- Core is the single stdin/CLI-shortcuts owner for every watch shape; the host never subscribes to stdin (mirrored in `packages/browser/AGENTS.md`). The shortcuts fan out to whichever executors the run has: `t`/`p` are node-only (the browser rerun pipeline takes no filter input) and render greyed hints otherwise. They install before the first cycle, so a rerun key stays gated until every executor the run has is past its first cycle — tracked per executor, because a mixed run's node side gets there first while the browser host still has no watch session to answer with. One gate covers every key, the node-only `t`/`p` included: `p` queues no browser cycle, but the `context.fileFilters` it writes are state the browser host re-reads while collecting the entries for its next one (`t`'s pattern crosses the seam only inside the runtime config projected at launch, so a later `t` never reaches the browser side at all). Settled, not succeeded: a first cycle that threw is done starting up and reported itself, and gating on success would leave a mixed run whose browser boot failed unable to answer any key on its healthy node side either. Once a side is settled but has no session left, the request itself is what must say so, rather than resolving as though the rerun happened. The stdin owner shares that one gate instead of deriving its own: `t`/`p` ask for input before they call anything, and a prompt opened while gated throws away what the user typed or drops the key without a word.
- `src/core/isBrowserProject.ts` stays outside `src/core/browser/` on purpose: it is the shared routing predicate every node-path module reads, not browser-mode implementation.
- Browser projects run their own pre-cycle `globalSetup` stage (`src/core/browser/globalSetupStage.ts`), distinct from the node `src/core/globalSetup.ts` — don't merge the two.

### Config merge (`src/cli`)

- A later/CLI layer overrides only the leaves it sets — it never wholesale-replaces a nested object an earlier layer owns.
- `browser` (and its `providerOptions`) merges with `plainDeepMerge`, NOT `mergeRsbuildConfig`: it carries opaque third-party data (Playwright options), so functions/arrays must be replaced, not chained/concatenated. Never re-add a `{ ...merged.browser, ...config.browser }` spread.
- CLI options apply to **every** config layer (root and each project), not once.
- Wildcard object options (`--browser.*`, `--source.*`, `--dev.*`, `--output.*`) must be registered in `allowedWildcardOptions` in `src/cli/commands.ts`; `coverage` and `pool` bypass that allowlist through their own normalize passes. When changing merge behavior, add a test asserting sibling/nested keys survive a partial override.
- `--coverage.exclude` appends to the config's exclude list while `--coverage.include` replaces it. The asymmetry is asserted explicitly in `tests/cli/init.test.ts` (PR #1336), but no written rationale exists — treat it as behavior to preserve, and don't "align" the two without a maintainer decision.

### Mock/build seam (`src/core/plugins`)

- `rs.mock` hoisting/rewriting happens at build time inside rspack's native `RstestPlugin`; registration happens at runtime inside the injected `mockRuntimeCode.js` registry. The `rstest_*` member names are the wire contract between the two — renaming either side alone breaks mocking.
- Setup files and test files must share one webpack runtime chunk — mock state lives on that runtime's `__webpack_require__`.
- `@rstest/core` must stay external to the runtime-published global: hoisted callbacks run above bundled imports, so a bundled provider module would load too late.
- Raw runtime/loader files resolved via `__dirname` at build time ↔ the dist copy list in `rslib.config.ts` — adding/renaming one requires updating both.

### Test runtime (`src/runtime`)

- Everything in `src/runtime/` executes inside the test execution context (forks child, worker thread, or browser page — browser-safe parts re-exported through `src/browserRuntime.ts`), never in the host CLI process.
- Live-binding contract: under `isolate: false` one worker runs many files while user modules persist, so every injected API member is built once with a stable identity and resolves the running file's `FileContext` at call time — never as a per-file closure.
- A new `Rstest` API member → add to `globalApiList` (compile-enforced exhaustiveness) and export a forwarder in `src/runtime/api/public.ts`.
- A new `RunnerHooks` callback → forward it in `runInPool`'s hooks object and in the browser client entry (`packages/browser/src/client/entry.ts`), which builds its own hooks.

### Reporters (`src/reporter`)

- Reporters are passive consumers: `RunnerEventSink` updates `stateManager` before reporter fanout, so TTY renderers read state, not event payloads.
- `reportersMap` is locked to the `BuiltInReporterNames` union via `satisfies`; a new built-in name needs both plus `BuiltinReporterOptions` (not compile-guarded).
- The md output format is a spec'd contract snapshot-tested in `e2e/reporter/md.test.ts` — behavior changes require snapshot updates there.
- The blob filename grammar has a single owner; `mergeReports` must keep using `isBlobFile` rather than re-encoding the pattern. Likewise both sides must key `BlobData.files` through `blobFileKey`, never by test path alone — a path is ambiguous once several projects run the same file.
- `BlobData` is a same-version wire format between `BlobReporter` and `mergeReports`: a `version` mismatch is rejected outright, never partially merged. The merge replays the reporter lifecycle from each file's recorded event track, where every event stores the payload the reporter received verbatim and replay is pure playback — never reconstruct a payload from other blob data (completeness is compile-guarded on both sides). Like sharding, the blob reporter is rejected in watch mode at reporter construction — blobs feed the one-shot merge workflow only, so a track never spans two run cycles.

## Commands

```bash
# Build
pnpm --filter @rstest/core build          # Build via Rslib
pnpm --filter @rstest/core dev            # Watch mode build

# Test
pnpm --filter @rstest/core test           # Run all unit tests
pnpm --filter @rstest/core test -- tests/core/rsbuild.test.ts  # Single file

# Lint
pnpm --filter @rstest/core lint
```

## Do

- Use `.mjs` for runtime loaders (e.g., `importActualLoader.mjs`)
- Place tests in `tests/` mirroring `src/` structure
- Use `@vitest/expect` and `@vitest/snapshot` for assertion/snapshot
- Use `picocolors` for terminal colors
- Use `pathe` for cross-platform paths

## Don't

- Don't bypass the worker pool for test execution
- Don't use `console.log` directly; use the logger utilities (sole sanctioned exception: `NonTTYProgressNotifier`'s progress output)
- Don't call timer globals (`setTimeout` etc.) directly in `src/runtime/` — user tests may enable fake timers; use `getRealTimers()` from `runtime/util` (lint-enforced via `no-restricted-syntax`)
- Don't fan runner lifecycle events out to reporters or `stateManager` directly; route them through `RunnerEventSink`
- Don't add a `RuntimeConfig` field without declaring its node/browser disposition in `executorCapabilities`
