import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { delay, getProjectItems } from './helpers';

suite('Configuration Integration', () => {
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

    try {
      await delay(500);

      const defaultRootsSpec = getProjectItems(testController);
      assert.equal(
        defaultRootsSpec.length,
        5,
        'Should discover all test files',
      );

      // 1) Only discover *.spec.js/ts files
      await config.update(
        'testFileGlobPattern',
        ['**/*.spec.[jt]s'],
        vscode.ConfigurationTarget.Workspace,
      );

      await delay(500);

      const rootsSpec = getProjectItems(testController);
      assert.ok(rootsSpec.length >= 1, 'Should discover spec files');
      assert.ok(
        rootsSpec.some((it) => it.id.endsWith('/test/jsFile.spec.js')),
        'Should include jsFile.spec.js',
      );
      assert.ok(
        !rootsSpec.some((it) => it.id.endsWith('/test/jsFile.spec.js.txt')),
        'Should not include jsFile.spec.js.txt',
      );
      // Ensure no duplicate non-spec-only additions by counting unique suffixes
      assert.ok(
        !rootsSpec.some((it) => it.id.endsWith('/test/foo.test.ts')),
        'Should not include foo.test.ts when only *.spec.* is configured',
      );

      // 2) Only discover *.test.* files
      await config.update(
        'testFileGlobPattern',
        ['**/*.test.*'],
        vscode.ConfigurationTarget.Workspace,
      );

      await delay(500);

      const rootsTest = getProjectItems(testController);
      assert.ok(rootsTest.length >= 1, 'Should discover test files');
      assert.ok(
        rootsTest.some((it) => it.id.endsWith('/test/foo.test.ts')),
        'Should include foo.test.ts',
      );
      assert.ok(
        rootsTest.some((it) => it.id.endsWith('/test/index.test.ts')),
        'Should include index.test.ts',
      );
      assert.ok(
        rootsTest.some((it) => it.id.endsWith('/test/tsxFile.test.tsx')),
        'Should include tsxFile.test.tsx',
      );
      assert.ok(
        rootsTest.some((it) => it.id.endsWith('/test/jsxFile.test.jsx')),
        'Should include jsxFile.test.jsx',
      );
      assert.ok(
        !rootsTest.some((it) => it.id.endsWith('/test/jsFile.spec.js')),
        'Should not include jsFile.spec.js when only *.test.* is configured',
      );
    } finally {
      // restore previous setting
      await config.update(
        'testFileGlobPattern',
        undefined,
        vscode.ConfigurationTarget.Workspace,
      );
      await delay(200);
      // Clean up test artifacts
      const fixturesVscodeDir = path.join(folders[0].uri.fsPath, '.vscode');
      if (fs.existsSync(fixturesVscodeDir)) {
        fs.rmSync(fixturesVscodeDir, { recursive: true, force: true });
      }
    }
  });
});
