# @rstest/adapter-rslib

Converts Rslib config to Rstest config via `withRslibConfig`.

## Commands

```bash
pnpm --filter @rstest/adapter-rslib build
pnpm --filter @rstest/adapter-rslib dev     # Watch mode
pnpm --filter @rstest/adapter-rslib test
pnpm --filter @rstest/adapter-rslib lint
```

## Constraints

- Don't add features unrelated to Rslib config conversion — keep the adapter thin.
- Don't change the semantics of Rslib config options during conversion; map them, don't reinterpret them.
- Route conversion logic shared with the other adapters through `@rstest/core/internal/adapter` in core, so adapter-rsbuild, adapter-rslib, and adapter-rspack stay in lockstep instead of forking local copies.
- `testEnvironment` intentionally inverts the other adapters' default: Rslib builds Node-first libraries, so only an explicit `web` output target maps to `happy-dom` and everything else defaults to `node`. Don't "align" it with the `resolveTestEnvironmentFromTarget` default used by adapter-rsbuild/adapter-rspack.
