import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runTests } from '@vscode/test-electron';

/**
 * Per-run scratch dir for everything VS Code writes: its user data, and the
 * workspace file it opens.
 *
 * It has to live in the OS temp dir rather than under the extension. VS Code
 * opens its main IPC socket inside the user data dir, macOS caps unix socket
 * paths at 104 bytes, and the default `<extension>/.vscode-test/user-data`
 * overruns that in a deep checkout — a Git worktree under
 * `.claude/worktrees/<name>/` already costs ~125 bytes, and VS Code then dies
 * with `listen EINVAL` before any test loads (microsoft/vscode-test#232).
 * Hashing the extension path keeps parallel checkouts off each other's state.
 */
function runDir(extensionPath: string): string {
  const key = createHash('sha256').update(extensionPath).digest('hex');
  return mkdtempSync(path.join(tmpdir(), `rstest-vscode-${key.slice(0, 8)}-`));
}

/**
 * Write the workspace the Extension Host opens, pointing at the fixture folders
 * by absolute path.
 *
 * The workspace file is test state, not an inert fixture: `workspace.test.ts`
 * calls `updateWorkspaceFolders` to add and remove `workspace-2`, and VS Code
 * persists folder changes back into the file it opened. Checking one in means
 * every run rewrites it — and an assertion failing between the add and the
 * remove leaves `workspace-2` in it, so the next run starts from a different
 * workspace. Generating it per run keeps each run's starting state identical
 * and keeps a failure from reaching the repository.
 */
function writeWorkspaceFile(
  dir: string,
  fixturesRoot: string,
  corePackageJson: string,
): string {
  const file = path.join(dir, 'fixtures.code-workspace');
  const workspace = {
    folders: [{ path: path.join(fixturesRoot, 'workspace-1') }],
    settings: { 'rstest.rstestPackagePath': corePackageJson },
  };
  writeFileSync(file, `${JSON.stringify(workspace, null, 2)}\n`);
  return file;
}

async function main() {
  // The folder containing the Extension Manifest package.json
  // Passed to `--extensionDevelopmentPath`
  const extensionDevelopmentPath = path.resolve(__dirname, '../');

  // The path to the extension test script
  // Passed to --extensionTestsPath
  const extensionTestsPath = path.resolve(__dirname, './suite/index');

  // Note: __dirname points to tests-dist at runtime, so resolve back to tests/
  const fixturesRoot = path.resolve(__dirname, '../tests/fixtures');
  const scratchDir = runDir(extensionDevelopmentPath);

  try {
    const corePackageJson = path.resolve(
      extensionDevelopmentPath,
      '../core/package.json',
    );
    // Download VS Code, unzip it and run the integration test
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        // Launch the Extension Host with the fixtures workspace
        writeWorkspaceFile(scratchDir, fixturesRoot, corePackageJson),
        // This disables all extensions except the one being testing
        '--disable-extensions',
        `--user-data-dir=${scratchDir}`,
        `--extensions-dir=${path.join(scratchDir, 'extensions')}`,
      ],
    });
  } catch {
    console.error('Failed to run tests');
    process.exitCode = 1;
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

main();
