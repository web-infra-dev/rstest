# @rstest/core

Core testing framework for Rstest. Provides CLI, test runner, reporter, and worker pool.

## Module structure

- `src/cli/` — CLI commands, initialization
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
