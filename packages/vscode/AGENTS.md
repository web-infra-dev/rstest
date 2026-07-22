# Rstest VS Code extension

## Architecture

Two-process design: the extension (`src/extension.ts`, TestController + test tree) spawns a worker (`src/worker/`, spawn owned by `src/master.ts`) that runs tests and reports back over Node `child_process` IPC with `serialization: 'advanced'` (WebSocket was replaced by IPC in #691 — values must survive structured clone). The worker protocol types in `src/types.ts` are shared by both sides — a protocol change must land on both ends in the same commit.

Tests are split by harness and the two patterns must not mix in one file: unit tests live in `tests/unit/` and run via rstest; E2E tests live in `tests/suite/` and run inside the VS Code Extension Host. For stable test-tree assertions in E2E, use `toLabelTree()` from `tests/suite/helpers.ts`.

## Commands

```bash
npm run build                 # Build with rslib
npm run build:local           # Build with sourcemaps
npm run watch                 # Watch mode
npm run test:unit             # Unit tests via rstest
npm run test:e2e              # E2E tests (downloads VS Code)
npm run lint                  # Rslint check
```

## Conventions

- camelCase file names (e.g., `testTree.ts`, `parserTest.ts`); PascalCase classes.

## References

- [VS Code Testing Guide](https://code.visualstudio.com/api/extension-guides/testing)
- [TestController API](https://code.visualstudio.com/api/references/vscode-api#TestController)
- [TestItem API](https://code.visualstudio.com/api/references/vscode-api#TestItem)
