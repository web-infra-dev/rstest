# @rstest/core

Core testing framework for Rstest. Provides CLI, test runner, reporter, and worker pool.

## Module structure

- `src/cli/` — CLI commands, initialization (CLI → config merge contract: `src/cli/AGENTS.md`)
- `src/core/` — Rsbuild integration, test scheduling, state management
- `src/core/plugins/` — Rsbuild plugins (mock loader, external handling)
- `src/runtime/` — Test runtime (expect, spy, fakeTimers, fixtures)
- `src/runtime/runner/` — Test runner implementation
- `src/runtime/worker/` — Worker process for test execution
- `src/reporter/` — Output reporters (verbose, summary, junit, GitHub Actions)
- `src/pool/` — Worker pool management (forks)
- `src/coverage/` — Coverage integration
- `src/types/` — TypeScript type definitions
- `src/utils/` — Shared utilities

## Executor contract (node + browser isomorphism)

Core owns the run-cycle contract shared by the node pool and `@rstest/browser`:

- `src/core/finalizeRun.ts` — `finalizeRunCycle`, the single finalize implementation for node-only, browser-only, and mixed runs: reduces each executor's `ExecutorCycleOutcome` into the run verdict (merged results, coverage merge + report, reporter `onTestRunEnd`, exit code, bail message). Non-watch runs must exit through it exactly once; browser watch runs self-finalize host-side instead. Exit codes never downgrade: a later zero must not clear a prior non-zero.
- `src/core/runnerEventSink.ts` — `RunnerEventSink`, the single event pump for runner lifecycle events on both transports (node pool RPC and browser dispatch). One sink per project, bound to that project's `normalizedConfig` (`onConsoleLog` filter, snapshot path resolution), feeding `stateManager` and reporters.
- `src/core/executorCapabilities.ts` — declarative per-executor disposition (`supported` / `ignored-warn` / `error` / `stripped`) of every `RuntimeConfig` field. Adding a `RuntimeConfig` field without a row here is a compile error; the browser wire projection (`src/core/runtimeConfigProjection.ts`) and browser config validation derive from this table.

## Commands

```bash
# Build
pnpm --filter @rstest/core build          # Build via Rslib
pnpm --filter @rstest/core dev            # Watch mode build

# Test
pnpm --filter @rstest/core test           # Run all unit tests
pnpm --filter @rstest/core test -- tests/core/rsbuild.test.ts  # Single file

# Typecheck
pnpm --filter @rstest/core typecheck
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
- Don't use `console.log` directly; use the logger utilities
- Don't call timer globals (`setTimeout` etc.) directly in `src/runtime/` — user tests may enable fake timers; use `getRealTimers()` from `runtime/util` (lint-enforced via `no-restricted-syntax`)
- Don't fan runner lifecycle events out to reporters or `stateManager` directly; route them through `RunnerEventSink`
- Don't add a `RuntimeConfig` field without declaring its node/browser disposition in `executorCapabilities`
