# Repository Guidelines

## Project Structure & Module Organization

- Root tooling (e.g., `pnpm-workspace.yaml`, `rstest.config.ts`) configures the monorepo. Run all commands from the repository root unless noted.
- Implementation code lives in `packages/core/src`, organized by feature. Unit tests sit beside their domain in `packages/core/tests` with mirrored folder names.
- Examples and integration scenarios reside in `examples/`, while end-to-end scripts live under `e2e/`. Keep assets local to the package they support.
- The `e2e/` folder packages contains the integration test cases.

## Build, Test, and Development Commands

- `pnpm install` — install all workspace dependencies.
- `pnpm typecheck` runs type checking.
- `pnpm build` compiles all buildable workspaces (excluding examples and test fixtures).
- `pnpm e2e` enters `e2e/` and runs the integration suite with its local `pnpm test` command.
- `pnpm test` runs unit tests for all Rstest projects.
- `pnpm format` formats sources with Prettier and normalizes headings.
- `pnpm lint` executes Biome, the spelling check, and `pnpm lint:type`.
- `pnpm lint:type` runs `rslint` for additional lint coverage.

## Coding Style & Naming Conventions

- Favor explicit, type-safe interfaces—lean on TypeScript's generics, `readonly`, and discriminated unions instead of loose `any` usage.
- Use `camelCase` for variables/functions, `PascalCase` for exported classes/types, and `SCREAMING_SNAKE_CASE` only for shared constants.
- Keep modules focused: one primary export per file, co-locate helper utilities when they are private to that feature.
- Prefer pure functions and deterministic utilities; isolate side effects near I/O boundaries.
- Document externally consumed APIs with concise TSDoc blocks and include representative usage snippets when behavior is non-obvious.

## Testing Guidelines

<!-- TODO: -->

## Commit & Pull Request Guidelines

- Adopt Conventional Commits (`type(scope): title`) as seen in `git log`—`feat`, `fix`, `docs`, and `chore` are common.
- Each PR should: explain the motivation, list notable changes, include testing evidence (`pnpm --filter @rstest/core test` output), and reference related issues.
- Keep diffs focused; split large efforts into reviewable chunks and ensure lint/tests pass before requesting review.
