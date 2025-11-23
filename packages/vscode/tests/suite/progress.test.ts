import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { getTestItems, waitFor } from './helpers';

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

    const item = await waitFor(() => {
      const item = [
        'workspace-1',
        'rstest.config.ts',
        'progress.test.ts',
      ].reduce(
        (item, label) =>
          item &&
          getTestItems(item.children).find((child) => child.label === label),
        {
          children: testController.items,
        } as vscode.TestItem | undefined,
      );
      assert.ok(item);
      return item;
    });

    const { promise, resolve } = Promise.withResolvers();

    let output = '';
    const failedMessages: vscode.TestMessage[] = [];
    const passedItems: vscode.TestItem[] = [];
    const skippedItems: vscode.TestItem[] = [];

    const mockRun: vscode.TestRun = {
      isPersisted: true,
      name: '',
      token: new vscode.CancellationTokenSource().token,
      onDidDispose: new vscode.EventEmitter<void>().event,
      addCoverage: () => {
        // ignore
      },
      appendOutput: (message) => {
        output += message;
      },
      end: () => {
        resolve(null);
      },
      enqueued: () => {
        // ignore
      },
      errored: () => {
        // ignore
      },
      failed: (_test, message = []) => {
        failedMessages.push(...(message as vscode.TestMessage[]));
      },
      passed: (test) => {
        passedItems.push(test);
      },
      skipped: (test) => {
        skippedItems.push(test);
      },
      started: () => {
        // ignore
      },
    };

    rstestInstance.startTestRun(
      new vscode.TestRunRequest([item], undefined, rstestInstance.runProfile),
      false,
      mockRun,
    );

    await promise;

    assert.match(output, /3 failed/);
    assert.match(output, /1 passed/);
    assert.match(output, /1 skipped/);

    assert.equal(passedItems.length, 1);
    assert.equal(skippedItems.length, 1);
    assert.equal(failedMessages.length, 5);

    assert.equal(failedMessages[0].message, 'expected 1 to equal 2');
    assert.equal(failedMessages[0].expectedOutput, '2');
    assert.equal(failedMessages[0].actualOutput, '1');

    assert.equal(
      failedMessages[1].message,
      'expected { a: 1 } to equal { b: 1 }',
    );
    assert.equal(
      failedMessages[1].expectedOutput,
      `Object {
  "b": 1,
}`,
    );
    assert.equal(
      failedMessages[1].actualOutput,
      `Object {
  "a": 1,
}`,
    );

    assert.equal(
      failedMessages[2].message,
      'Snapshot `s1 > should mismatch inline snapshot 1` mismatched',
    );
    assert.equal(failedMessages[2].expectedOutput, '"value"');
    assert.equal(failedMessages[2].actualOutput, '"str"');
    assert.equal(failedMessages[2].contextValue, 'canUpdateSnapshot');

    assert.equal(failedMessages[3].message, 'after suite');
    assert.equal(failedMessages[4].message, 'after root suite');
  });
});
