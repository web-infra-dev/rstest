# @rstest/adapter-rsbuild

Rsbuild configuration adapter for Rstest. Converts Rsbuild config to Rstest config.

## Module structure

- `src/index.ts` — Package entry, exports `withRsbuildConfig`
- `src/toRstestConfig.ts` — Rsbuild-to-Rstest config conversion logic

## Commands

```bash
pnpm --filter @rstest/adapter-rsbuild build
pnpm --filter @rstest/adapter-rsbuild dev     # Watch mode
pnpm --filter @rstest/adapter-rsbuild test
pnpm --filter @rstest/adapter-rsbuild typecheck
```

## Do

- Follow existing config mapping conventions in `toRstestConfig.ts`
- Keep the adapter lightweight

## Don't

- Don't add rsbuild-unrelated features
- Don't modify rsbuild config semantics
