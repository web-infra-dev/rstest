# @rstest/core

Core testing framework for Rstest.

## Subsystem map

- `src/cli/` — CLI parsing and the CLI → config merge
- `src/core/` — run orchestration: Rsbuild integration, executor seam, scheduling, state management
- `src/core/browser/` — core-side browser-mode orchestration (load boundary, browser-only run, mixed-run planning)
- `src/core/plugins/` — Rsbuild/Rspack plugins (mock seam, externals, entry assembly)
- `src/runtime/` — test-side runtime: expect, spy, fakeTimers, fixtures, runner, worker entry
- `src/reporter/` — output reporters
- `src/pool/` — node worker pool; read `src/pool/AGENTS.md` before touching the cross-process contract
- `src/coverage/` — coverage integration; read `src/coverage/AGENTS.md` before touching the cross-package contract
- `src/types/`, `src/utils/` — shared types and utilities

## Executor contract (node + browser isomorphism)

Core owns the run-cycle contract shared by the node pool and `@rstest/browser`:

- `finalizeRunCycle` is the single finalize implementation for node-only, browser-only, and mixed runs, on both commands: it reduces each executor's `ExecutorCycleOutcome` into the run verdict (merged results, coverage merge + report, reporter `onTestRunEnd`, exit code, bail message). A non-watch run exits through it exactly once; a watch run passes through it once per cycle, and a cycle is the only thing that may write the exit code.
- `RunnerEventSink` is the single event pump for runner lifecycle events on both transports (node pool RPC and browser dispatch). One sink per project, bound to that project's `normalizedConfig`, feeding `stateManager` and reporters. No direct reporter/`stateManager` fanout anywhere else.
- `executorCapabilities` declares the per-executor disposition (`supported` / `ignored-warn` / `error` / `stripped`) of every `RuntimeConfig` field. Adding a field without a row is a compile error; the browser wire projection (`projectRuntimeConfig`) keeps its own hand-written field list, held in lockstep by `tests/core/executorCapabilities.test.ts`.

## Cross-cutting invariants

Contracts between modules or processes — not readable from any single file.

### Run cycle (`src/core`)

- Exit codes never downgrade: a later zero must not clear a prior non-zero.
- `stateManager` reset is core-owned (top of a non-watch run, or `prepareWatchRerunState` per watch cycle) — executors never reset it, so bail reads stay cycle-scoped.
- `@rstest/browser` is version-locked to core and loaded through the core-owned `BrowserHostModule` contract; the browser package constrains its exports against it via `satisfies`.
- Reporter output is sorted by `testPath`, deliberately decoupled from the perf-first execution order (failed-first, then longest-processing-time). Don't "fix" one by changing the other.

### Watch mode

- Cycle-scoped watch support is the default and carries no marker: every feature is expected to hold under `rstest watch`, so only the two exceptions declare themselves — explicit rejection before anything runs, and documented degradation. A feature that misbehaves in watch without one of those markers is a bug to fix, not an undeclared stance.
- Reject only when watch semantics are undefinable (an inherently one-shot concept), never merely unimplemented — and a rejected option must stay unreachable from every other config layer (config file, plugin hooks).
- A degradation counts only when marked twice, for the two audiences that would otherwise misread it: in code at the site that skips the work, so the next reader of that branch does not take it for a bug; and where the user meets it — a runtime message at the point of use, or the en/zh website docs when the run stays silent. A degradation neither audience can find is a bug, not a stance.
- Browser projects' `globalSetup` never running in watch is a gap to close, not a design, even though the code reads as deliberate (the stage is wired only into non-watch branches). Closing it must also remove the docs sentence declaring it.

### Browser orchestration (`src/core/browser`)

- `src/core/runTests.ts` stays a coarse orchestrator — split projects → node executor `init()` barrier → plan → drive executors → finalize. Browser-mode detail lives under `src/core/browser/`, behind the `BrowserHostModule` load boundary in `src/core/browser/loader.ts`, never inline in the orchestrator.
- One orchestrator branch breaks executor isomorphism, deliberately and commented at the call site: the browser-only fast path, because constructing a `NodeExecutor` boots a node Rsbuild instance that a zero-node run must not pay for.
- Watch is one core-owned loop for every executor and every trigger (`src/core/watchSession.ts`): an executor signals through `TestExecutor.onInvalidate` having already resolved its scope, and core answers with reset → `runCycle` → `finalizeRunCycle` → next trace buffer → ready banner. Cycles are queued, so two can never interleave on the shared `stateManager`; a transport whose new trigger supersedes its own in-flight work cancels it as it signals the replacement, so the queue never makes the user wait out a stale run. A trigger that resolves to no work must not signal — a cycle that runs nothing reports "no test files need re-run", which a scope simply missing that executor's files should not print.
- A watch run whose launch opened no session (the browser host found no test files, or failed before its runtime came up) has no trigger that can ever fire, so it must not print the ready banner — nothing could answer it. Its exit code is the one a cycle cannot carry, so it stays a host-side launch-path write; the process itself keeps running on the CLI's config-restart watcher.
- Core is the single stdin/CLI-shortcuts owner for every watch shape; the host never subscribes to stdin (mirrored in `packages/browser/AGENTS.md`). The shortcuts fan out to whichever executors the run has: `t`/`p` are node-only (the browser rerun pipeline takes no filter input) and render greyed hints otherwise.
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
