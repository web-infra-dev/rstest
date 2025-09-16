# Repository guidelines

## Project structure & module organization

- Run workspace commands from the repository root; `pnpm-workspace.yaml` wires packages and shared tooling.
- Core implementation lives in `packages/core/src`, with mirrored tests in `packages/core/tests` (for example, `src/core/plugins/mockLoader.mjs` ↔ `tests/core/mockLoader.test.ts`).
- `examples/` holds usage demos, `e2e/` carries integration suites and fixtures, and `scripts/` plus `website/` supply build utilities and documentation assets.
- Keep assets, fixtures, and build artifacts inside the package that owns them to avoid cross-package coupling.

## Build, test, and development commands

- `pnpm install` installs the entire workspace.
- `pnpm --filter @rstest/core build` compiles the core package via Rslib.
- `pnpm --filter @rstest/core dev` watches the core build for rapid iteration.
- `pnpm --filter @rstest/core test` executes the unit suite; add `-- tests/core/mockLoader.test.ts` for a single file and append `-- --updateSnapshot` only when behavior changes.
- `pnpm e2e` runs the browser-level regression suite inside `e2e/`.
- `pnpm biome check` (aliased by `pnpm lint`) formats code, enforces lint rules, and performs spell checks.

## Coding style & naming conventions

- Treat packages as ESM-first: use `.mjs` for runtime loaders and `.ts` for typed utilities; avoid mixing CommonJS helpers.
- Follow two-space indentation, LF line endings, and keep files ASCII unless the feature already relies on Unicode.
- Use `camelCase` for locals, `PascalCase` for exported types/components, and `SCREAMING_SNAKE_CASE` only for shared constants.
- Keep modules focused on a primary export with internal helpers defined nearby, and run `pnpm biome check` or `pnpm format` before committing.

## Testing guidelines

- Unit tests use `@rstest/core`; place new specs under `packages/<pkg>/tests` mirroring the source layout.
- Run targeted suites during development (`pnpm --filter @rstest/core test -- tests/core/<suite>.test.ts`), then execute the full filter before pushing.
- Integration flows live in `e2e/`; isolate fixtures per scenario and trigger them via `pnpm e2e`.
- Cover success paths, error handling, and transformation edge cases. Update snapshots deliberately and keep coverage thresholds from `rstest.config.ts` intact.

## Commit & pull request guidelines

- Follow Conventional Commits (`type(scope): subject`) consistent with the existing history (`feat`, `fix`, `docs`, `chore`).
- Each PR should explain motivation, summarize key changes, attach relevant test command output, and reference issues or discussions.
- Ensure `pnpm lint` and the necessary test commands succeed before requesting review, and keep diffs scoped for efficient feedback.
