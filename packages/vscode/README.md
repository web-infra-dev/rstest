# Rstest VS Code Extension

A VS Code extension that discovers and runs tests for your project.

## Configuration

The extension reads settings with the following priority:

1. Workspace Folder
2. Workspace
3. User
4. Default

| Setting                      | Type               | Scope    | Default                          | Description                                                   |
| ---------------------------- | ------------------ | -------- | -------------------------------- | ------------------------------------------------------------- |
| `rstest.testFileGlobPattern` | string[]           | Resource | `["**/*.test.*", "**/*.spec.*"]` | Glob pattern(s) used to discover test files in the workspace. |

Notes

- Must be an array of strings.
- Applied per workspace folder when set at the folder level.

### Examples

settings.json (User/Workspace):

```json
{
  "rstest.testFileGlobPattern": ["**/*.test.ts", "**/*.spec.tsx"]
}
```

Per-folder override (settings.json in a specific folder):

```json
{
  "rstest.testFileGlobPattern": ["apps/web/**/*.test.ts"]
}
```

## How it works

- On activation, the extension eagerly scans for test files using `rstest.testFileGlobPattern` and populates the Test Explorer tree.
- File system watchers keep the tree in sync as files are created/changed/deleted.
- Tests are parsed to build a nested tree using the file contents.
