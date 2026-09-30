# Rstest VS Code extension

## Architecture

Two-process design: the extension (`src/extension.ts`, TestController + test tree) spawns a worker (`src/worker/`, spawn owned by `src/master.ts`) that runs tests and reports back over Node `child_process` IPC with the default JSON serialization (WebSocket was replaced by IPC in #691 — values must survive a JSON round-trip, so no `RegExp`, `Map`, `undefined` fields, etc.; thrown errors cross only because both `createBirpc` calls spread `rpcErrorCodec`). Do not switch to `serialization: 'advanced'`: the V8 serializer's wire format follows the V8 version, and the Extension Host (VS Code's Electron) and the worker (the user's Node) do not share one. The worker protocol types in `src/types.ts` are shared by both sides — a protocol change must land on both ends in the same commit.

This is the final standalone release, superseded by Rstack (`rstack.rstack`). `activate` must stay gated only on `extensions.getExtension('rstack.rstack')`: enabled Rstack takes over regardless of workspace trust or `rstack.rstest.enable`. Keep the status bar's extension-change listener and reload state; controller ownership cannot change in a running window.

Migration prompts must not block activation. The uninstall and install warnings have independent dismissal flags in `globalState`, never settings. Unsupported-core errors cannot be permanently dismissed. Every unsupported-core notification must use `showUnsupportedCoreMessage` so it offers Install Rstack.

The final release supports only `@rstest/core` `^0.12.0`. Keep the version guard in `resolveRstestPaths` before API resolution and worker creation, including configured package paths. Keep `versionCheck` free of VS Code imports: the worker also uses its error formatter.

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
