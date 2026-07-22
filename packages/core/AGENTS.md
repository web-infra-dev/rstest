# @rstest/core

Core testing framework for Rstest. Provides CLI, test runner, reporter, and worker pool.

## Module structure

- `src/cli/` — CLI commands, initialization (CLI → config merge contract: `src/cli/AGENTS.md`)
- `src/core/` — Rsbuild integration, test scheduling, state management (run-cycle deep dive: `src/core/AGENTS.md`)
- `src/core/plugins/` — Rsbuild/Rspack plugins (mock runtime injection, importActual loader, external handling; deep dive: `src/core/plugins/AGENTS.md`)
- `src/runtime/` — Test runtime (expect, spy, fakeTimers, fixtures; deep dive: `src/runtime/AGENTS.md`)
- `src/runtime/runner/` — Test runner implementation
- `src/runtime/worker/` — Worker process for test execution
- `src/reporter/` — Output reporters (default, dot, verbose, github-actions, junit, json, md, blob; deep dive: `src/reporter/AGENTS.md`)
- `src/pool/` — Worker pool management (`forks` and `threads` worker kinds, default `forks`; deep dive: `src/pool/AGENTS.md`)
- `src/coverage/` — Coverage integration (cross-package pipeline deep dive: `src/coverage/AGENTS.md`)
- `src/types/` — TypeScript type definitions
- `src/utils/` — Shared utilities

## Executor contract (node + browser isomorphism)

Core owns the run-cycle contract shared by the node pool and `@rstest/browser`:

- `src/core/finalizeRun.ts` — `finalizeRunCycle`, the single finalize implementation for node-only, browser-only, and mixed runs: reduces each executor's `ExecutorCycleOutcome` into the run verdict (merged results, coverage merge + report, reporter `onTestRunEnd`, exit code, bail message). Non-watch runs must exit through it exactly once; browser watch runs self-finalize host-side instead. Exit codes never downgrade: a later zero must not clear a prior non-zero.
- `src/core/runnerEventSink.ts` — `RunnerEventSink`, the single event pump for runner lifecycle events on both transports (node pool RPC and browser dispatch). One sink per project, bound to that project's `normalizedConfig` (`onConsoleLog` filter, snapshot path resolution), feeding `stateManager` and reporters.
- `src/core/executorCapabilities.ts` — declarative per-executor disposition (`supported` / `ignored-warn` / `error` / `stripped`) of every `RuntimeConfig` field. Adding a `RuntimeConfig` field without a row here is a compile error; browser config validation derives from this table at runtime, while the browser wire projection (`src/core/runtimeConfigProjection.ts`) maintains its own hand-written field list and is kept in lockstep with the table by `tests/core/executorCapabilities.test.ts`.

## Commands

```bash
# Build
pnpm --filter @rstest/core build          # Build via Rslib
pnpm --filter @rstest/core dev            # Watch mode build

# Test
pnpm --filter @rstest/core test           # Run all unit tests
pnpm --filter @rstest/core test -- tests/core/rsbuild.test.ts  # Single file

# Typecheck — no per-package script; run repo-wide from the root
pnpm typecheck                            # rslint --type-check (needs built package .d.ts)
```

## Do

- Use `.mjs` for runtime loaders (e.g., `importActualLoader.mjs`)
- Use `.ts` for typed utilities
- Place tests in `tests/` mirroring `src/` structure
- Use `@vitest/expect` and `@vitest/snapshot` for assertion/snapshot
- Use `picocolors` for terminal colors
- Use `pathe` for cross-platform paths
- Keep modules focused with a single primary export

## Don't

- Don't bypass the worker pool for test execution
- Don't use `console.log` directly; use the logger utilities (sole sanctioned exception: `NonTTYProgressNotifier`'s `[PROGRESS]` lines in `src/reporter/nonTtyProgressNotifier.ts`)
- Don't call timer globals (`setTimeout` etc.) directly in `src/runtime/` — user tests may enable fake timers; use `getRealTimers()` from `runtime/util` (lint-enforced via `no-restricted-syntax`)
- Don't fan runner lifecycle events out to reporters or `stateManager` directly; route them through `RunnerEventSink`
- Don't add a `RuntimeConfig` field without declaring its node/browser disposition in `executorCapabilities`
