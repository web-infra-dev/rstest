import assert from 'node:assert';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import vscode from 'vscode';
import { waitFor } from './helpers';

// A separate Extension Host starts in an empty workspace so notification
// observation is installed before the extension can auto-activate.
export async function run() {
  const folder = vscode.workspace.workspaceFolders![0];
  const root = folder.uri.fsPath;
  const core = path.join(root, 'core');
  mkdirSync(core);
  writeFileSync(
    path.join(core, 'package.json'),
    JSON.stringify({
      name: '@rstest/core',
      version: '0.13.0',
      main: './index.js',
      exports: {
        '.': './index.js',
        './api': './api.js',
        './package.json': './package.json',
      },
    }),
  );
  writeFileSync(path.join(core, 'index.js'), 'module.exports = {};');
  writeFileSync(path.join(core, 'api.js'), 'exports.createRstest = () => {};');
  const workerMarker = path.join(root, 'worker-started');
  const preload = path.join(root, 'preload.cjs');
  writeFileSync(
    preload,
    `require('node:fs').writeFileSync(${JSON.stringify(workerMarker)}, 'started');`,
  );
  const config = vscode.workspace.getConfiguration('rstest', folder);
  await config.update(
    'rstestPackagePath',
    path.join(core, 'package.json'),
    vscode.ConfigurationTarget.WorkspaceFolder,
  );
  await config.update(
    'nodeExecArgs',
    ['--require', preload],
    vscode.ConfigurationTarget.WorkspaceFolder,
  );

  const errors: unknown[][] = [];
  const warnings: unknown[][] = [];
  const originalError = vscode.window.showErrorMessage;
  const originalWarning = vscode.window.showWarningMessage;
  vscode.window.showErrorMessage = (...args: unknown[]) => {
    errors.push(args);
    return Promise.resolve(undefined);
  };
  vscode.window.showWarningMessage = (...args: unknown[]) => {
    warnings.push(args);
    return Promise.resolve(undefined);
  };
  try {
    writeFileSync(path.join(root, 'rstest.config.js'), 'module.exports = {};');
    const extension = vscode.extensions.getExtension<{
      testController: vscode.TestController;
      workspaces: Map<string, { initialDiscovery: Promise<void> }>;
    }>('rstack.rstest');
    assert.ok(extension);
    const instance = await extension.activate();
    assert.ok(
      instance.testController,
      'Activation must return without waiting for a prompt',
    );
    await waitFor(() => assert.equal(errors.length, 1));
    await Promise.all(
      Array.from(
        instance.workspaces.values(),
        (workspace) => workspace.initialDiscovery,
      ),
    );
    assert.deepStrictEqual(errors, [
      [
        'This extension is no longer maintained and only supports @rstest/core ^0.12.0 (found 0.13.0). Install the Rstack extension (rstack.rstack) instead.',
        'Install Rstack',
      ],
    ]);
    assert.deepStrictEqual(
      warnings,
      [],
      'The unsupported-core error must take precedence over the install warning',
    );
    assert.equal(
      existsSync(workerMarker),
      false,
      'No worker may start for unsupported core',
    );
    assert.equal(instance.testController.items.size, 0);
    console.log(
      'Unsupported core E2E passed: actionable error, no migration warning, no worker.',
    );
  } finally {
    vscode.window.showErrorMessage = originalError;
    vscode.window.showWarningMessage = originalWarning;
  }
}
