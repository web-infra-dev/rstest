import assert from 'node:assert';
import * as vscode from 'vscode';
import { getTestItemByLabels, toLabelTree, waitFor } from './helpers';

suite('Runtime list suite', () => {
  test('Extension should discover test cases from runtime', async () => {
    // Check if the extension is activated
    const extension = vscode.extensions.getExtension('rstack.rstest');
    if (extension && !extension.isActive) {
      await extension.activate();
    }

    // Get the rstest test controller that the extension should have created
    const rstestInstance = extension?.exports;
    const testController: vscode.TestController =
      rstestInstance?.testController;

    const config = vscode.workspace.getConfiguration('rstest');

    await waitFor(() => {
      const item = getTestItemByLabels(testController.items, [
        'test',
        'each.test.ts',
      ]);
      assert.deepStrictEqual(toLabelTree(item.children), [
        {
          children: [
            {
              label: 'case',
            },
          ],
          label: 'suite',
        },
        {
          label: 'unnamed test',
        },
        {
          label: 'unnamed test',
        },
      ]);
    });

    // change config to runtime
    await config.update('testCaseCollectMethod', 'runtime');
    await waitFor(() => {
      const item = getTestItemByLabels(testController.items, [
        'test',
        'each.test.ts',
      ]);
      assert.deepStrictEqual(toLabelTree(item.children), [
        {
          children: [
            {
              label: 'case',
            },
          ],
          label: 'suite',
        },
        {
          children: [
            {
              label: 'suite 1 case 1',
            },
            {
              label: 'suite 1 case 2',
            },
          ],
          label: 'suite 1',
        },
        {
          children: [
            {
              label: 'suite 2 case 1',
            },
            {
              label: 'suite 2 case 2',
            },
          ],
          label: 'suite 2',
        },
      ]);
    });

    // restore config
    config.update('testCaseCollectMethod', undefined);
    await waitFor(() => {
      const item = getTestItemByLabels(testController.items, [
        'test',
        'each.test.ts',
      ]);
      assert.deepStrictEqual(toLabelTree(item.children), [
        {
          children: [
            {
              label: 'case',
            },
          ],
          label: 'suite',
        },
        {
          label: 'unnamed test',
        },
        {
          label: 'unnamed test',
        },
      ]);
    });

    // test list should be updated after test run
    rstestInstance.startTestRun(
      new vscode.TestRunRequest(
        undefined,
        undefined,
        rstestInstance.runProfile,
      ),
      new vscode.CancellationTokenSource().token,
      false,
    );
    await waitFor(() => {
      const item = getTestItemByLabels(testController.items, [
        'test',
        'each.test.ts',
      ]);
      assert.deepStrictEqual(toLabelTree(item.children), [
        {
          children: [
            {
              label: 'case',
            },
          ],
          label: 'suite',
        },
        {
          children: [
            {
              label: 'suite 1 case 1',
            },
            {
              label: 'suite 1 case 2',
            },
          ],
          label: 'suite 1',
        },
        {
          children: [
            {
              label: 'suite 2 case 1',
            },
            {
              label: 'suite 2 case 2',
            },
          ],
          label: 'suite 2',
        },
      ]);
    });
  });
});
