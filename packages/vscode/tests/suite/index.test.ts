import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { delay, getProjectItems, getTestItems } from './helpers';

suite('Extension Test Suite', () => {
  vscode.window.showInformationMessage('Start all tests.');

  // Helper: recursively transform a TestItem into a label-only tree.
  // Children are sorted by label for stable comparisons.
  function toLabelTree(item: vscode.TestItem): {
    label: string;
    children?: { label: string; children?: any[] }[];
  } {
    const nodes: { label: string; children?: any[] }[] = [];
    item.children.forEach((child) => {
      nodes.push(toLabelTree(child));
    });
    nodes.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    return nodes.length
      ? { label: item.label, children: nodes }
      : { label: item.label };
  }

  test('Extension should discover test items', async () => {
    // Wait for the extension to activate and discover tests
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Check if workspace is opened correctly
    const workspaceFolders = vscode.workspace.workspaceFolders;

    assert.ok(
      workspaceFolders && workspaceFolders.length > 0,
      'Workspace should be opened',
    );
    assert.ok(
      workspaceFolders[0].uri.path.includes('fixtures'),
      'Should open the fixtures workspace',
    );

    // Check if the extension is activated
    const extension = vscode.extensions.getExtension('rstack.rstest');
    if (extension && !extension.isActive) {
      await extension.activate();
    }

    // Wait additional time for test discovery
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // focus on the testing view of this extension
    await vscode.commands.executeCommand('workbench.view.testing.focus');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Get the rstest test controller that the extension should have created
    const rstestInstance = extension?.exports;
    const testController: vscode.TestController =
      rstestInstance?.testController;

    if (testController) {
      // Trigger refresh to ensure test discovery
      if (testController.refreshHandler) {
        // await testController.refreshHandler();
      }

      console.log(`Test controller found with ID: ${testController.id}`);
      console.log(
        `Test controller has ${testController.items.size} root items`,
      );

      // Iterate through test items and log them
      testController.items.forEach((item: vscode.TestItem) => {
        console.log(`Root test item: ${item.id} - ${item.label}`);
        if (item.children.size > 0) {
          item.children.forEach((child: vscode.TestItem) => {
            console.log(`  Child test item: ${child.id} - ${child.label}`);
          });
        }
      });

      // Assert that we have test items and check for specific items
      assert.ok(
        testController.items.size > 0,
        'Test controller should have discovered test items',
      );

      const workspaceItems = getTestItems(testController.items);
      assert.equal(workspaceItems[0].label, 'workspace-1');

      const projectItems = getTestItems(workspaceItems[0].children);
      assert.equal(projectItems[0].label, 'rstest.config.ts');

      const itemsArray = getProjectItems(testController);

      const foo = itemsArray.find((it) => it.id.endsWith('/test/foo.test.ts'));
      const index = itemsArray.find((it) =>
        it.id.endsWith('/test/index.test.ts'),
      );
      const jsSpec = itemsArray.find((it) =>
        it.id.endsWith('/test/jsFile.spec.js'),
      );
      const jsxFile = itemsArray.find((it) =>
        it.id.endsWith('/test/tsxFile.test.tsx'),
      );
      const tsxFile = itemsArray.find((it) =>
        it.id.endsWith('/test/tsxFile.test.tsx'),
      );

      assert.ok(foo, 'foo.test.ts should be discovered');
      // Validate foo.test.ts structure via label-only tree
      const fooTree = toLabelTree(foo!);
      assert.deepStrictEqual(fooTree, {
        label: 'foo.test.ts',
        children: [
          {
            label: 'l1',
            children: [
              {
                label: 'l2',
                children: [
                  {
                    label: 'l3',
                    children: [
                      { label: 'should also return "foo1"' },
                      { label: 'should return "foo1"' },
                    ],
                  },
                  { label: 'should also return "foo"' },
                  { label: 'should return "foo"' },
                ],
              },
            ],
          },
        ],
      });

      assert.ok(index, 'index.test.ts should be discovered');
      const indexTree = toLabelTree(index!);
      assert.deepStrictEqual(indexTree, {
        label: 'index.test.ts',
        children: [
          {
            label: 'Index',
            children: [
              { label: 'should add two numbers correctly' },
              { label: 'should test source code correctly' },
            ],
          },
        ],
      });

      assert.ok(jsSpec, 'jsFile.spec.js should be discovered');
      assert.ok(jsxFile, 'tsxFile.test.tsx should be discovered');
      assert.ok(tsxFile, 'tsxFile.test.tsx should be discovered');
    } else {
      assert.fail(
        'Test controller should be accessible through extension exports',
      );
    }
  });
});
