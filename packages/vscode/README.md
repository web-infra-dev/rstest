# Rstest VS Code extension

Rstest is a VS Code extension that discovers, displays, and runs tests in your workspace. It builds a rich Test Explorer tree from your test files and keeps it up to date as files change.

## Features

- Discovers test files via configurable glob patterns
- Parses test structure to build a nested tree (describe/suite/test)
- Runs individual tests, suites, or entire files
- Watches the filesystem and updates the tree on create/change/delete
- Shows editor diagnostics for failed tests

## Activation

The extension activates automatically when your workspace contains Rstest configuration files (e.g., `rstest.config.*`, `rstest.workspace.*`, `rstest.projects.*`). On activation, it eagerly scans the workspace and populates the Test Explorer.

## Configuration

| Setting                        | Type                 | Default                                        | Description                                                                                                                                                                                                                                                           |
| ------------------------------ | -------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rstest.rstestPackagePath`     | `string`             | `undefined`                                    | The path to a `package.json` file of a Rstest executable (it's usually inside `node_modules`) in case the extension cannot find it. It will be used to resolve Rstest API paths. This should be used as a last resort fix. Supports `${workspaceFolder}` placeholder. |
| `rstest.configFileGlobPattern` | `string[]`           | `["**/rstest.config.{mjs,ts,js,cjs,mts,cts}"]` | Glob patterns used to discover config files.                                                                                                                                                                                                                          |
| `rstest.testCaseCollectMethod` | `"ast" \| "runtime"` | `"ast"`                                        | `"ast"`: Fast, only supports basic test cases. <br /> `"runtime"`: Slow, supports all test cases, including dynamic test generation methods (each/for/extend).                                                                                                        |
| `rstest.applyDiagnostic`       | `boolean`            | `true`                                         | Show diagnostics in editor and Problems panel for failed tests.                                                                                                                                                                                                       |

### Error lens compatibility

If you use the Error Lens extension and want to avoid duplicated inline diagnostics, add this to your `settings.json`:

- `errorLens.excludeBySource`: `['rstest']`

This extension does not apply this setting automatically.

## How it works

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

### Packaging & publishing

- Local package (current platform): `npm run package:vsix`
- Publish (current platform): `npm run publish:vsce` (requires `VSCE_PAT`)

CI

- On tag push or manual dispatch, GitHub Actions runs on Linux and publishes for all platforms using `vsce publish --target` (win32/darwin/linux; x64 and arm64).
- Configure the `VSCE_PAT` repository secret for Marketplace publishing.
