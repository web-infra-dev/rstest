# @rstest/adapter-rslib

Rslib configuration adapter for Rstest. Converts Rslib config to Rstest config.

## Module structure

- `src/index.ts` — Package entry, exports `withRslibConfig`
- `src/tsconfig.ts` — Tsconfig loading utilities

## Commands

```bash
pnpm --filter @rstest/adapter-rslib build
pnpm --filter @rstest/adapter-rslib dev     # Watch mode
pnpm --filter @rstest/adapter-rslib typecheck
pnpm --filter @rstest/adapter-rslib test
```

## Do

- Follow existing config mapping conventions
- Keep the adapter lightweight

## Don't

- Don't add rslib-unrelated features
- Don't modify rslib config semantics
