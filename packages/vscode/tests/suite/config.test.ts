import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { delay, waitForConfigValue } from './helpers';

suite('Configuration Integration', () => {
  function clearController(ctrl: vscode.TestController) {
    const ids: string[] = [];
    ctrl.items.forEach((item) => {
      ids.push(item.id);
    });
    for (const id of ids) ctrl.items.delete(id);
  }

  test('respects rstest.testFileGlobPattern (array-only)', async () => {
    const extension = vscode.extensions.getExtension('rstack.rstest');
    assert.ok(extension, 'Extension should be present');
    if (extension && !extension.isActive) {
      await extension.activate();
    }

    const rstestInstance: any = extension?.exports;
    const testController: vscode.TestController =
      rstestInstance?.testController;
    assert.ok(testController, 'Test controller should be exported');

    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders && folders.length > 0, 'Workspace folder is required');

    const config = vscode.workspace.getConfiguration('rstest');
    const prev = config.get('testFileGlobPattern');

    try {
      // 1) Only discover *.spec.* files
      await config.update(
        'testFileGlobPattern',
        ['**/*.spec.*'],
        vscode.ConfigurationTarget.Workspace,
      );

      clearController(testController);
      await testController.resolveHandler?.(undefined as any);
      await delay(500);

      const rootsSpec: vscode.TestItem[] = [];
      testController.items.forEach((it) => {
        rootsSpec.push(it);
      });
      assert.ok(rootsSpec.length >= 1, 'Should discover spec files');
      assert.ok(
        rootsSpec.some((it) =>
          it.id.endsWith('/tests/fixtures/test/jsFile.spec.js'),
        ),
        'Should include jsFile.spec.js',
      );
      // Ensure no duplicate non-spec-only additions by counting unique suffixes
      assert.ok(
        !rootsSpec.some((it) =>
          it.id.endsWith('/tests/fixtures/test/foo.test.ts'),
        ),
        'Should not include foo.test.ts when only *.spec.* is configured',
      );

      // 2) Only discover *.test.* files
      await config.update(
        'testFileGlobPattern',
        ['**/*.test.*'],
        vscode.ConfigurationTarget.Workspace,
      );

      clearController(testController);
      await testController.resolveHandler?.(undefined as any);
      await delay(500);

      const rootsTest: vscode.TestItem[] = [];
      testController.items.forEach((it) => {
        rootsTest.push(it);
      });
      assert.ok(rootsTest.length >= 1, 'Should discover test files');
      assert.ok(
        rootsTest.some((it) =>
          it.id.endsWith('/tests/fixtures/test/foo.test.ts'),
        ),
        'Should include foo.test.ts',
      );
      assert.ok(
        rootsTest.some((it) =>
          it.id.endsWith('/tests/fixtures/test/index.test.ts'),
        ),
        'Should include index.test.ts',
      );
      assert.ok(
        rootsTest.some((it) =>
          it.id.endsWith('/tests/fixtures/test/tsxFile.test.tsx'),
        ),
        'Should include tsxFile.test.tsx',
      );
      assert.ok(
        rootsTest.some((it) =>
          it.id.endsWith('/tests/fixtures/test/jsxFile.test.jsx'),
        ),
        'Should include jsxFile.test.jsx',
      );
      assert.ok(
        !rootsTest.some((it) =>
          it.id.endsWith('/tests/fixtures/test/jsFile.spec.js'),
        ),
        'Should not include jsFile.spec.js when only *.test.* is configured',
      );
    } finally {
      // restore previous setting
      await config.update(
        'testFileGlobPattern',
        (prev as any) ?? undefined,
        vscode.ConfigurationTarget.Workspace,
      );
      clearController(testController);
      await testController.resolveHandler?.(undefined as any);
      await delay(200);
      // Clean up test artifacts
      const fixturesVscodeDir = path.join(folders[0].uri.fsPath, '.vscode');
      if (fs.existsSync(fixturesVscodeDir)) {
        fs.rmSync(fixturesVscodeDir, { recursive: true, force: true });
      }
    }
  });

  test('respects rstest.logLevel', async () => {
    const config = vscode.workspace.getConfiguration('rstest');
    const prev = config.get('logLevel');

    try {
      await config.update(
        'logLevel',
        'debug',
        vscode.ConfigurationTarget.Workspace,
      );
      await delay(500);

      let logLevel = config.get('logLevel');

      logLevel = await waitForConfigValue({
        initialValue: logLevel,
        read: () => vscode.workspace.getConfiguration('rstest').get('logLevel'),
        expected: 'debug',
      });

      assert.strictEqual(logLevel, 'debug');
    } finally {
      await config.update(
        'logLevel',
        (prev as any) ?? undefined,
        vscode.ConfigurationTarget.Workspace,
      );
      await delay(100);
    }
  });
});
