import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

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
      ],
    });
  } catch {
    console.error('Failed to run tests');
    process.exit(1);
  }
}

main();
