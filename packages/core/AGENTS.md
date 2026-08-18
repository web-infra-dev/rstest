# @rstest/core

Core testing framework for Rstest.

## Subsystem map

- `src/cli/` — CLI parsing and the CLI → config merge
- `src/api/` — public instance API; capture reporters project internal results into host-safe return values
- `src/core/` — run orchestration: Rsbuild integration, executor seam, scheduling, state management
- `src/core/browser/` — core-side browser-mode detail (load boundary, browser-side run planning, pre-cycle globalSetup stage)
- `src/core/plugins/` — Rsbuild/Rspack plugins (mock seam, externals, entry assembly)
- `src/runtime/` — test-side runtime: expect, spy, fakeTimers, fixtures, runner, worker entry
- `src/reporter/` — output reporters
- `src/pool/` — node worker pool; read `src/pool/AGENTS.md` before touching the cross-process contract
- `src/coverage/` — coverage integration; read `src/coverage/AGENTS.md` before touching the cross-package contract
- `src/types/`, `src/utils/` — shared types and utilities

## CLI/API construction

`resolveRunnerInputs` owns configuration-source resolution and `buildResolvedRunner` owns selection plus context construction. The CLI/API isomorphism RFC sets the public instance API as the CLI's target driver; commands not migrated yet may call this shared chain directly. Every change must narrow the gap between those drivers: expose new CLI needs as public observations or capabilities rather than adding CLI-only execution paths.

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
- Browser projects' `globalSetup` runs once per watch session, before the initial browser cycle and before the node dev server starts: its environment change-set is stored on the context and composed into both node workers and the browser launch, so a node cycle dispatched first would miss it. The node dependency check runs ahead of the stage in turn, so a node project that cannot run rejects the session before user setup runs. Reruns reuse the context-local change-set, and teardown drains with the watch teardown; the en/zh `global-setup` docs state all three.
- The node watch trigger holding its dev-compile hook for the whole cycle — and so losing test files created or deleted in that window — is a gap to close too, not a degradation, so it carries no user-facing marker: there is no stance to declare, only an unclosed one. Closing it means resolving the affected scope inside the hook and handing it to the cycle the way the browser transport already does, so the one destructive stats pull still happens once per compile. Anything short of that (a per-executor queue, a shorter cycle) leaves the window open.

### Browser orchestration (`src/core/browser`)

- `src/core/runTests.ts` stays a coarse orchestrator: planner resolve → construct the executors the plan calls for → drive them → finalize. Every run shape — node-only, browser-only, mixed — walks that one assembly and differs only in which executors the plan produced; don't add a shape branch above or below it. Browser-mode detail lives under `src/core/browser/` behind the `BrowserHostModule` load boundary, never inline in the orchestrator.
- One planner (`src/core/planner.ts`) is the init barrier for both commands: `runTests` and `listTests` each resolve through `createTestPlanner`, inside which both sides' `modifyRstestConfig` hooks fire (the browser's via a files-only discovery boot), so no executor is constructed against a plan still moving. The browser-side `src/core/browser/runPlanner.ts` is constructed and spent inside it — never hold a second planner to keep in step, and never give `listTests` a project-subset or shard decision of its own: every past list-only filter ("have the hooks run yet?") re-derived settlement from proxy signals and broke one config-shape at a time. The shard banner is planner-owned too — resolution only records counts, and the planner announces once after the barrier.
- The cold-start gate is a planner condition, not an orchestrator branch: zero node projects ⇒ the planner skips `prepareRsbuild` and returns no `nodeBuild`, and the orchestrator constructs a node executor exactly when a build came back. The gate is pinned inside the planner (`tests/core/planner.test.ts` spies on `prepareRsbuild`); re-deriving "is this browser-only?" in `runTests` is the shape the second-assembly regression returns in.
- Watch is one core-owned loop (`src/core/watchSession.ts`): an executor signals `TestExecutor.onInvalidate` with its scope already resolved, and core answers with reset → `runCycle` → `finalizeRunCycle` → next trace buffer → ready banner. Cycles queue, so two never interleave on the shared `stateManager`; a burst folds into the queued cycle only among same-kind triggers, and a fold unions file lists and nothing else — one trigger kind's state (e.g. `u`'s `updateSnapshot`) must never reach files another trigger chose. A trigger that resolves to no work must not signal.
- Two tracked fold gaps, not stances: the browser executor drops `updateSnapshot` on reruns (the host reads the live flag per page load), and closing that must keep the fold identity honest — the browser side erases trigger kind, so either the origin crosses the seam or `updateSnapshot` joins the fold-compared options. The node trigger still holds the dev-compile hook for its whole cycle (the Watch mode section tracks it) because its stats pull consumes a compile's changes exactly once.
- In watch the browser executor loads early — loading validates its config and can exit on a version mismatch, and the shared teardown and stdin owner close over it — but the **launch** (the first browser cycle) waits until node run resources are up, so a node dependency failure never leaves a browser mid-launch. `ensureRunResources` stays a required member of the node executor's own type, not an optional member of the shared seam `@rstest/browser` is version-locked to.
- A watch launch that opened no session prints no ready banner — no trigger could ever answer it. The no-test-files case raises the context-local exit status directly; a boot failure rides the cycle outcome. Either way the process stays alive on the CLI's config-restart watcher.
- Core is the single stdin/CLI-shortcuts owner for every watch shape (mirrored in `packages/browser/AGENTS.md`); `t`/`p` are node-only (the browser rerun pipeline takes no filter input) and render greyed hints otherwise. Rerun keys arm once every executor of the run has a _settled_ first cycle — settled, not succeeded — behind one gate that the prompt-opening `t`/`p` also check before asking for input; a settled side with no session must answer the request itself rather than resolve as though the rerun happened.
- Node watch planning builds its compiler environments and entry graph without startup file filters. Startup filters and interactive `p` selections narrow executor cycles only; the latter stays on the node watch target and must never be written back to the shared `RstestContext`, which the browser side also consumes. `a` clears that node selection and reuses the existing compiler graph.
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
- Under `isolate: false`, cache control invalidates only the test entry currently being dispatched. Clearing every discovered entry before every file breaks once-per-worker dependency state.
- Raw runtime/loader files resolved via `__dirname` at build time ↔ the dist copy list in `rslib.config.ts` — adding/renaming one requires updating both.

### Test runtime (`src/runtime`)

- Everything in `src/runtime/` executes inside the test execution context (forks child, worker thread, or browser page — browser-safe parts re-exported through `src/browserRuntime.ts`), never in the host CLI process.
- Live-binding contract: under `isolate: false` one worker runs many files while user modules persist, so every injected API member is built once with a stable identity and resolves the running file's `FileContext` at call time — never as a per-file closure.
- A new `Rstest` API member → add to `globalApiList` (compile-enforced exhaustiveness) and export a forwarder in `src/runtime/api/public.ts`.
- A new `RunnerHooks` callback → forward it in `runInPool`'s hooks object and in the browser client entry (`packages/browser/src/client/runner.ts`), which builds its own hooks.

### Reporters (`src/reporter`)

- Reporters are passive consumers: `RunnerEventSink` updates `stateManager` before reporter fanout, so TTY renderers read state, not event payloads.
- `reportersMap` is locked to the `BuiltInReporterNames` union via `satisfies`; a new built-in name needs both plus `BuiltinReporterOptions` (not compile-guarded).
- The md output format is a spec'd contract snapshot-tested in `e2e/reporter/md.test.ts` — behavior changes require snapshot updates there.
- The blob filename grammar has a single owner; `mergeReports` must keep using `isBlobFile` rather than re-encoding the pattern. Likewise both sides must key `BlobData.files` through `blobFileKey`, never by test path alone — a path is ambiguous once several projects run the same file.
- `BlobData` is a same-version wire format between `BlobReporter` and `mergeReports`: a `version` mismatch is rejected outright, never partially merged. The merge replays the reporter lifecycle from each file's recorded event track, where every event stores the payload the reporter received verbatim and replay is pure playback — never reconstruct a payload from other blob data (completeness is compile-guarded on both sides). Like sharding, the blob reporter is rejected in watch mode at reporter construction — blobs feed the one-shot merge workflow only, so a track never spans two run cycles.
- A blob stores collected coverage before report-stage filtering or untested-file backfill. Providers without deferred finalization support still serialize that collected map before running their shard-local reports and thresholds; capable providers defer reports and thresholds to `merge-reports`, which owns finalization against the unified map.

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
