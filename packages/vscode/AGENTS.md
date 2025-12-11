# Rstest VS Code Extension

VS Code extension providing integrated testing experience for Rstest.

## Architecture

Two-process design:

- Extension (`extension.ts`) — TestController, manages test tree
- Worker (`worker/index.ts`) — Runs tests via WebSocket communication

## Module structure

- `src/extension.ts` — Entry point, TestController setup
- `src/testTree.ts` — Builds TestItem tree from test files
- `src/parserTest.ts` — SWC-based test parser
- `src/master.ts` — Spawns and manages worker process
- `src/worker/` — Test runner and reporter
- `tests/suite/` — E2E tests (VS Code Extension Host)
- `tests/unit/` — Unit tests (rstest)

## Commands

```bash
npm run build                 # Build with rslib
npm run build:local           # Build with sourcemaps
npm run watch                 # Watch mode
npm run typecheck             # Type check
npm run test:unit             # Unit tests via rstest
npm run test:e2e              # E2E tests (downloads VS Code)
npm run lint                  # Biome check
```

## Do

- Use camelCase for files (e.g., `testTree.ts`, `parserTest.ts`)
- Use PascalCase for classes
- Place unit tests in `tests/unit/`, E2E in `tests/suite/`
- Use `toLabelTree()` from `tests/suite/index.test.ts` for stable tree assertions
- Keep changes minimal and focused
- Follow existing patterns in the codebase

## Don't

- Don't edit `dist/` directly
- Don't add dependencies without discussion
- Don't mix unit and E2E test patterns
- Don't modify worker protocol without updating both sides

## Testing loop

1. `npm run typecheck`
2. `npm run test:unit`
3. `npm run test:e2e`

## Key files

- `src/extension.ts` — Extension entry, TestController
- `src/testTree.ts` — Test tree builder
- `src/parserTest.ts` — Test file parser
- `src/master.ts` — Worker manager
- `src/worker/index.ts` — Worker entry
- `src/types.ts` — Shared type definitions

## Safety

Allowed: read files, typecheck, lint, unit tests

Ask first: E2E tests (slow), install dependencies, modify extension manifest

## When stuck

Ask a clarifying question or propose a plan before making large changes.

## References

- [VS Code Testing Guide](https://code.visualstudio.com/api/extension-guides/testing)
- [TestController API](https://code.visualstudio.com/api/references/vscode-api#TestController)
- [TestItem API](https://code.visualstudio.com/api/references/vscode-api#TestItem)
