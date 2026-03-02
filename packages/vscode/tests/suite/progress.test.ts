import * as assert from 'node:assert';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as vscode from 'vscode';
import { delay, getTestItemByLabels, waitFor } from './helpers';

suite('Test Progress Reporting', () => {
  let { promise, resolve } = Promise.withResolvers();
  let output = '';
  let failedMessages: vscode.TestMessage[] = [];
  let passedItems: vscode.TestItem[] = [];
  let skippedItems: vscode.TestItem[] = [];
  let createMockRunCalledTimes = 0;

  const createMockRun = () => {
    createMockRunCalledTimes++;

    ({ promise, resolve } = Promise.withResolvers());
    output = '';
    failedMessages = [];
    passedItems = [];
    skippedItems = [];

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

    return mockRun;
  };

  test('reports test progress with error details and snapshots', async () => {
    const extension = vscode.extensions.getExtension('rstack.rstest');
    assert.ok(extension, 'Extension should be present');
    if (extension && !extension.isActive) {
      await extension.activate();
    }

    const rstestInstance: any = extension?.exports;
    const testController: vscode.TestController =
      rstestInstance?.testController;
    assert.ok(testController, 'Test controller should be exported');

    const item = await waitFor(() =>
      getTestItemByLabels(testController.items, ['test', 'progress.test.ts']),
    );

    rstestInstance.startTestRun(
      new vscode.TestRunRequest([item], undefined, rstestInstance.runProfile),
      new vscode.CancellationTokenSource().token,
      false,
      createMockRun,
    );

    await promise;

    assert.match(output, /3 failed/);
    assert.match(output, /1 passed/);
    assert.match(output, /1 skipped/);

    // should include stderr output from test file
    assert.match(output, /stdout: progress\.test\.ts/);
    assert.match(output, /stderr: progress\.test\.ts/);

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
    assert.equal(failedMessages[2].expectedOutput, '"world"');
    assert.equal(failedMessages[2].actualOutput, '"hello"');
    assert.equal(failedMessages[2].contextValue, 'canUpdateSnapshot');

    assert.equal(failedMessages[3].message, 'after suite');
    assert.equal(failedMessages[4].message, 'after root suite');

    assert.ok(item.uri, 'Progress test item should have a file uri');
    const diagnostics = vscode.languages.getDiagnostics(item.uri);
    assert.ok(diagnostics.length > 0, 'Failed run should publish diagnostics');
    assert.ok(
      diagnostics.some((diagnostic) => diagnostic.source === 'rstest'),
      'Diagnostics source should be rstest',
    );
    assert.ok(
      diagnostics.some((diagnostic) =>
        diagnostic.message.includes('expected 1 to equal 2'),
      ),
      'Diagnostics should include assertion error messages',
    );
  });

  test('can run a single test case', async () => {
    const extension = vscode.extensions.getExtension('rstack.rstest');
    assert.ok(extension, 'Extension should be present');
    if (extension && !extension.isActive) {
      await extension.activate();
    }

    const rstestInstance: any = extension?.exports;
    const testController: vscode.TestController =
      rstestInstance?.testController;
    assert.ok(testController, 'Test controller should be exported');

    const item = await waitFor(() =>
      getTestItemByLabels(testController.items, [
        'test',
        'index.test.ts',
        'Index',
        'should add two numbers correctly',
      ]),
    );

    rstestInstance.startTestRun(
      new vscode.TestRunRequest([item], undefined, rstestInstance.runProfile),
      new vscode.CancellationTokenSource().token,
      false,
      createMockRun,
    );

    await promise;

    assert.equal(failedMessages.length, 0);
    assert.equal(skippedItems.length, 0);
    assert.equal(passedItems.length, 1);
    assert.equal(passedItems[0]?.label, 'should add two numbers correctly');
    assert.match(output, /1 passed/);

    const progressFileUri = vscode.Uri.file(
      path.resolve(
        __dirname,
        '../../tests/fixtures/workspace-1/test/progress.test.ts',
      ),
    );
    assert.equal(
      vscode.languages.getDiagnostics(progressFileUri).length,
      0,
      'Successful run should clear previous diagnostics',
    );
  });

  test('reports test progress with continuous run', async () => {
    const extension = vscode.extensions.getExtension('rstack.rstest');
    assert.ok(extension, 'Extension should be present');
    if (extension && !extension.isActive) {
      await extension.activate();
    }

    const rstestInstance: any = extension?.exports;
    const testController: vscode.TestController =
      rstestInstance?.testController;
    assert.ok(testController, 'Test controller should be exported');

    const item = await waitFor(() =>
      getTestItemByLabels(testController.items, ['test', 'progress.test.ts']),
    );

    const cancellationSource = new vscode.CancellationTokenSource();
    rstestInstance.startTestRun(
      new vscode.TestRunRequest(
        [item],
        undefined,
        rstestInstance.runProfile,
        true,
      ),
      cancellationSource.token,
      false,
      createMockRun,
    );

    await promise;

    assert.match(output, /3 failed/);
    assert.match(output, /1 passed/);
    assert.match(output, /1 skipped/);

    // File watchers can be noisy on CI; only rely on "next run happened"
    // semantics rather than absolute run counts.
    const waitForNextRun = async () => {
      const prev = createMockRunCalledTimes;
      await waitFor(() => assert.ok(createMockRunCalledTimes > prev));
      await promise;
    };

    const replaceContentInFile = async (
      file: string,
      searchValue: string,
      replaceValue: string,
    ) => {
      const fullPath = path.resolve(
        __dirname,
        '../../tests/fixtures/workspace-1/test',
        file,
      );
      await writeFile(
        fullPath,
        (await readFile(fullPath, 'utf-8')).replace(searchValue, replaceValue),
      );
    };

    await replaceContentInFile('progress.test.ts', 'hello', 'world');
    await waitForNextRun();
    assert.match(output, /2 failed/);
    assert.match(output, /2 passed/);
    assert.match(output, /1 skipped/);

    await replaceContentInFile('foo.test.ts', 'foo', 'bar');
    await waitForNextRun();
    assert.match(output, /No test files need re-run/);
    assert.equal(failedMessages.length, 0);
    assert.equal(passedItems.length, 0);
    assert.equal(skippedItems.length, 0);

    await replaceContentInFile('foo.test.ts', 'bar', 'foo');
    await waitForNextRun();
    assert.match(output, /No test files need re-run/);
    assert.equal(failedMessages.length, 0);
    assert.equal(passedItems.length, 0);
    assert.equal(skippedItems.length, 0);

    const canceledAt = createMockRunCalledTimes;
    cancellationSource.cancel();

    await replaceContentInFile('progress.test.ts', 'world', 'hello');
    await delay(2000);
    assert.equal(
      createMockRunCalledTimes,
      canceledAt,
      'should not re-run after canceled',
    );
  });
});
