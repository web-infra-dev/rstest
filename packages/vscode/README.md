# Rstest VS Code extension

Rstest is a VS Code extension that discovers, displays, and runs tests in your workspace. It builds a rich Test Explorer tree from your test files and keeps it up to date as files change.

## Features

- Discovers test files via configurable glob patterns
- Parses test structure to build a nested tree (describe/suite/test)
- Runs individual tests, suites, or entire files
- Watches the filesystem and updates the tree on create/change/delete

## Activation

The extension activates automatically when your workspace contains Rstest configuration files (e.g., `rstest.config.*`, `rstest.workspace.*`, `rstest.projects.*`). On activation, it eagerly scans the workspace and populates the Test Explorer.

## Configuration

| Setting                      | Type     | Scope    | Default                          | Description                                                   |
| ---------------------------- | -------- | -------- | -------------------------------- | ------------------------------------------------------------- |
| `rstest.testFileGlobPattern` | string[] | Resource | `["**/*.test.*", "**/*.spec.*"]` | Glob pattern(s) used to discover test files in the workspace. |

## How it Works

- On activation, the extension scans for test files using `rstest.testFileGlobPattern` and creates a Test Explorer tree.
- File system watchers keep the tree synchronized as files are created, modified, or deleted.
- Test content is parsed to identify nested suites and tests so you can run them granularly.

## Development

Common commands (run from this package):

- `npm run build` — Build with rslib
- `npm run watch` — Rebuild on change
- `npm run typecheck` — TypeScript noEmit check
- `npm run test:unit` — Unit tests via Rstest
- `npm run test:e2e` — VS Code Extension Host E2E tests

### Packaging & Publishing

- Local package (current platform): `npm run package:vsix`
- Publish (current platform): `npm run publish:vsce` (requires `VSCE_PAT`)

CI
- On tag push or manual dispatch, GitHub Actions runs on Linux and publishes for all platforms using `vsce publish --target` (win32/darwin/linux; x64 and arm64).
- Configure the `VSCE_PAT` repository secret for Marketplace publishing.
