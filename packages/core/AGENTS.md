# @rstest/core

Core testing framework for Rstest. Provides CLI, test runner, reporter, and worker pool.

## Module structure

- `src/cli/` — CLI commands, initialization
- `src/core/` — Rsbuild integration, test orchestration, state management
- `src/core/plugins/` — Rsbuild plugins (mock loader, external handling)
- `src/runtime/` — Test runtime (expect, spy, fakeTimers, fixtures)
- `src/runtime/runner/` — Test runner implementation
- `src/runtime/worker/` — Worker process for test execution
- `src/reporter/` — Output reporters (verbose, summary, junit, GitHub Actions)
- `src/pool/` — Worker pool management (forks)
- `src/coverage/` — Coverage integration
- `src/types/` — TypeScript type definitions
- `src/utils/` — Shared utilities

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

- Don't mix CommonJS and ESM in the same module
- Don't add heavy dependencies without discussion
- Don't bypass the worker pool for test execution
- Don't use `console.log` directly; use the logger utilities

## Key files

- `src/index.ts` — Package entry, exports public API
- `src/cli/index.ts` — CLI entry point
- `src/core/rstest.ts` — Main Rstest class
- `src/runtime/runner/runner.ts` — Test runner implementation
- `src/types/config.ts` — Configuration types

## Testing

- Tests live in `tests/` with structure mirroring `src/`
- Example: `src/core/rsbuild.ts` → `tests/core/rsbuild.test.ts`
- Use `npx rstest --globals` for running tests
- Update snapshots with `-- --updateSnapshot` only when behavior changes

## Good examples

- Runner implementation: `src/runtime/runner/runner.ts`
- Reporter pattern: `src/reporter/verbose.ts`
- Plugin pattern: `src/core/plugins/mockRuntime.ts`

## Safety

Allowed: read files, typecheck, lint, run single test files

Ask first: add dependencies, run full test suite, modify public API types

## When stuck

Ask a clarifying question or propose a plan before making large changes.
