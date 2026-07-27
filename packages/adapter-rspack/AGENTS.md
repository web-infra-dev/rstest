# @rstest/adapter-rspack

Converts Rspack config to Rstest config via `withRspackConfig`.

## Commands

```bash
# Build
pnpm --filter @rstest/adapter-rspack build
pnpm --filter @rstest/adapter-rspack dev     # Watch mode

# Test
pnpm --filter @rstest/adapter-rspack test

# Lint
pnpm --filter @rstest/adapter-rspack lint
```

## Constraints

- Route conversion logic shared with the other adapters through `@rstest/core/internal/adapter` in core, so this adapter, adapter-rsbuild, and adapter-rslib stay in lockstep instead of forking local copies.
- Don't change the semantics of a user's rspack options during conversion — the adapter maps config onto Rstest, it never reinterprets it.
- Don't maintain an options list in this file: the exported `WithRspackConfigOptions` type in `src/index.ts` is the source of truth, and the website owns user-facing API docs.
