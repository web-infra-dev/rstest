import { runTests } from '@vscode/test-electron';
import * as path from 'path';

async function main() {
  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, '../');

    // The path to the extension test script
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    // Download VS Code, unzip it and run the integration test
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        // This disables all extensions except the one being testing
        '--disable-extensions',
        `--folder-uri=file:${path.resolve(__dirname, '../fixtures')}`,
      ],
    });
  } catch {
    console.error('Failed to run tests');
    process.exit(1);
  }
}

main();
