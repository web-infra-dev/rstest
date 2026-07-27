import type vscode from 'vscode';

// Retains the last run's failure messages per test item so the
// `rstest.copyTestItemErrors` command can surface them. Kept separate from
// RstestDiagnostics because that store is gated on `rstest.applyDiagnostic` and
// drops messages without a resolvable source location, whereas copying errors
// should work regardless of the diagnostics setting and keep every message.
export class TestErrorStore {
  private readonly messagesByTest = new WeakMap<
    vscode.TestItem,
    vscode.TestMessage[]
  >();

  public set(testItem: vscode.TestItem, messages: vscode.TestMessage[]) {
    this.messagesByTest.set(testItem, messages);
  }

  public clear(testItem: vscode.TestItem) {
    this.messagesByTest.delete(testItem);
  }

  public get(testItem: vscode.TestItem): vscode.TestMessage[] {
    return this.messagesByTest.get(testItem) ?? [];
  }
}

// Flatten a TestMessage's text (string or MarkdownString) to plain text.
export function testMessageText(message: vscode.TestMessage): string {
  return typeof message.message === 'string'
    ? message.message
    : message.message.value;
}
