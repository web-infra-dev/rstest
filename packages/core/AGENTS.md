# @rstest/core

Core testing framework for Rstest.

## Subsystem map

- `src/cli/` — CLI parsing and the CLI → config merge
- `src/core/` — run orchestration: Rsbuild integration, executor seam, scheduling, state management
- `src/core/plugins/` — Rsbuild/Rspack plugins (mock seam, externals, entry assembly)
- `src/runtime/` — test-side runtime: expect, spy, fakeTimers, fixtures, runner, worker entry
- `src/reporter/` — output reporters
- `src/pool/` — node worker pool; read `src/pool/AGENTS.md` before touching the cross-process contract
- `src/coverage/` — coverage integration; read `src/coverage/AGENTS.md` before touching the cross-package contract
- `src/types/`, `src/utils/` — shared types and utilities

## Executor contract (node + browser isomorphism)

Core owns the run-cycle contract shared by the node pool and `@rstest/browser`:

- `finalizeRunCycle` is the single finalize implementation for node-only, browser-only, and mixed runs: it reduces each executor's `ExecutorCycleOutcome` into the run verdict (merged results, coverage merge + report, reporter `onTestRunEnd`, exit code, bail message). Non-watch runs must exit through it exactly once; browser watch runs self-finalize host-side instead, and core skips its finalize for browser-only and zero-node mixed watch runs.
- `RunnerEventSink` is the single event pump for runner lifecycle events on both transports (node pool RPC and browser dispatch). One sink per project, bound to that project's `normalizedConfig`, feeding `stateManager` and reporters. No direct reporter/`stateManager` fanout anywhere else.
- `executorCapabilities` declares the per-executor disposition (`supported` / `ignored-warn` / `error` / `stripped`) of every `RuntimeConfig` field. Adding a field without a row is a compile error; the browser wire projection (`projectRuntimeConfig`) keeps its own hand-written field list, held in lockstep by `tests/core/executorCapabilities.test.ts`.

## Cross-cutting invariants

Contracts between modules or processes — not readable from any single file.

### Run cycle (`src/core`)

- Exit codes never downgrade: a later zero must not clear a prior non-zero.
- `stateManager` reset is core-owned (top of a non-watch run, or `prepareWatchRerunState` per watch rerun) — executors never reset it, so bail reads stay cycle-scoped.
- `@rstest/browser` is version-locked to core and loaded through the core-owned `BrowserHostModule` contract; the browser package constrains its exports against it via `satisfies`.
- Reporter output is sorted by `testPath`, deliberately decoupled from the perf-first execution order (failed-first, then longest-processing-time). Don't "fix" one by changing the other.

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
- The blob filename grammar has a single owner; `mergeReports` must keep using `isBlobFile` rather than re-encoding the pattern.

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
