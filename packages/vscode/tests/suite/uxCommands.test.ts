import assert from 'node:assert';
import vscode from 'vscode';
import { getTestItemByLabels, waitFor } from './helpers';

suite('Editor / Test Explorer UX commands', () => {
  test('openOutput, copyErrorOutput, revealInTestExplorer, copyTestItemErrors', async () => {
    const extension = vscode.extensions.getExtension('rstack.rstest');
    assert.ok(extension, 'Extension should be present');
    if (!extension.isActive) {
      await extension.activate();
    }
    const rstestInstance: any = extension.exports;
    const controller: vscode.TestController = rstestInstance.testController;
    assert.ok(controller, 'Test controller should be exported');

    // openOutput just reveals the channel — it must not throw.
    await vscode.commands.executeCommand('rstest.openOutput');

    const fileItem = await waitFor(() =>
      getTestItemByLabels(controller.items, ['test', 'progress.test.ts']),
    );

    // copyErrorOutput copies the given message's text to the clipboard.
    await vscode.env.clipboard.writeText('');
    await vscode.commands.executeCommand('rstest.copyErrorOutput', {
      test: fileItem,
      message: new vscode.TestMessage('copied error text'),
    });
    assert.strictEqual(
      await vscode.env.clipboard.readText(),
      'copied error text',
    );

    // revealInTestExplorer delegates to the built-in reveal command; this
    // fails loudly if the command id or argument shape is wrong.
    assert.ok(fileItem.uri, 'test file item should have a uri');
    await vscode.commands.executeCommand(
      'rstest.revealInTestExplorer',
      fileItem.uri,
    );

    // Run the failing fixture so the error store is populated, then copy the
    // file item's aggregated errors.
    await rstestInstance.startTestRun(
      new vscode.TestRunRequest(
        [fileItem],
        undefined,
        rstestInstance.runProfile,
      ),
      new vscode.CancellationTokenSource().token,
      false,
    );

    await vscode.commands.executeCommand('rstest.copyTestItemErrors', fileItem);
    assert.match(
      await vscode.env.clipboard.readText(),
      /expected 1 to equal 2/,
    );
  });
});
