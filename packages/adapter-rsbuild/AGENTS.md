# @rstest/adapter-rsbuild

Converts Rsbuild config to Rstest config via `toRstestConfig`.

## Commands

```bash
pnpm --filter @rstest/adapter-rsbuild build
pnpm --filter @rstest/adapter-rsbuild dev     # Watch mode
pnpm --filter @rstest/adapter-rsbuild test
pnpm --filter @rstest/adapter-rsbuild lint
```

## Constraints

- Don't add features unrelated to Rsbuild config conversion — keep the adapter thin.
- Don't change the semantics of Rsbuild config options during conversion; map them, don't reinterpret them.
- Route conversion logic shared with the other adapters through `@rstest/core/internal/adapter` in core, so adapter-rsbuild, adapter-rslib, and adapter-rspack stay in lockstep instead of forking local copies.
