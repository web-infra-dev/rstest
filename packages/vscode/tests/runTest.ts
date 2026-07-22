import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runTests } from '@vscode/test-electron';

/**
 * VS Code opens its main IPC socket inside the user data dir, and macOS caps
 * unix socket paths at 104 bytes. The default `<extension>/.vscode-test/
 * user-data` overruns that in a deep checkout — a Git worktree under
 * `.claude/worktrees/<name>/` already costs ~125 bytes — and VS Code then dies
 * with `listen EINVAL` before any test loads. Anchoring the user data dir in
 * the OS temp dir keeps the socket path short regardless of checkout depth;
 * hashing the extension path keeps parallel checkouts off each other's state.
 */
function shortUserDataDir(extensionPath: string): string {
  const key = createHash('sha256').update(extensionPath).digest('hex');
  const dir = path.join(tmpdir(), `rstest-vscode-${key.slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function main() {
  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, '../');

    // The path to the extension test script
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    // Open this folder as the workspace in the Extension Host during tests
    // Note: __dirname points to tests-dist at runtime, so resolve back to tests/fixtures
    const workspacePath = path.resolve(
      __dirname,
      '../tests/fixtures/fixtures.code-workspace',
    );

    // Download VS Code, unzip it and run the integration test
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        // Launch the Extension Host with the fixtures workspace
        workspacePath,
        // This disables all extensions except the one being testing
        '--disable-extensions',
        '--user-data-dir',
        shortUserDataDir(extensionDevelopmentPath),
      ],
    });
  } catch {
    console.error('Failed to run tests');
    process.exit(1);
  }
}

main();
