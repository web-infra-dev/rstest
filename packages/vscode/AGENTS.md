# Repository Guidelines

Concise contributor guide for the Rstest VS Code extension package.

## Project Structure & Module Organization

- `src/` — TypeScript sources. Key modules: `extension.ts` (entry/TestController), `testTree.ts` (builds TestItem tree), `parserTest.ts` (SWC-based parser), `master.ts` (spawns worker), `worker/` (runner + reporter).
- `tests/` — E2E tests under `tests/suite/**`. Compiled to `tests-dist/` for the Extension Host.
- `tests/unit/**` — Unit tests executed by `@rstest/core` with fixtures in `tests/unit/fixtures`.
- `dist/` — Built extension output. Do not edit.
- Config: `tsconfig.json`, `tsconfig.test.json`, `rslib.config.ts`, `rstest.config.ts`.

## Build, Test, and Development Commands

- `npm run build` — Build with `rslib` (use `build:local` for sourcemaps).
- `npm run watch` — Rebuild on change.
- `npm run typecheck` — TypeScript `--noEmit` check.
- `npm run test:unit` — Run unit tests via `rstest`.
- `npm run test:e2e` — Compile tests and run VS Code Extension Host E2E (downloads VS Code on first run).
- `npm run lint` — Run Biome checks.

## Coding Style & Naming Conventions

- Language: TypeScript, 2-space indentation. Keep changes minimal and focused.
- Naming: camelCase for files and symbols; PascalCase for classes; follow existing patterns (e.g., `testTree.ts`, `parserTest.ts`).
- Linting: Biome (`npm run lint`). Prefer simple, readable logic over cleverness.

## Testing Guidelines

- Name tests `*.test.ts`. Place parser/unit tests in `tests/unit/**`; E2E tests in `tests/suite/**` (loaded by the E2E runner only).
- E2E opens `tests/fixtures` workspace automatically; use `toLabelTree()` from `tests/suite/index.test.ts` for stable tree assertions.
- Typical loop: `npm run typecheck` → `npm run test:unit` → `npm run test:e2e`.

## Commit & Pull Request Guidelines

- Write clear, imperative commit messages; keep PRs small and scoped. Reference issues (e.g., `Fixes #123`).
- Include rationale, testing notes, and screenshots/logs if relevant (e.g., label trees, error output).
- Avoid unrelated refactors; update or add tests with behavior changes.

## Architecture Overview

- Two-process design: VS Code extension (`extension.ts`) communicates with a worker (`worker/index.ts`) via WebSocket. Main sends `WorkerInitData`/`WorkerRunTestData`; worker emits `WorkerEventFinish`.

## References

- VS Code Testing Guide: https://code.visualstudio.com/api/extension-guides/testing
- VS Code Test API: https://code.visualstudio.com/api/references/vscode-api#tests
- VS Code `TestController` API: https://code.visualstudio.com/api/references/vscode-api#TestController
- VS Code `TestItem` API: https://code.visualstudio.com/api/references/vscode-api#TestItem
