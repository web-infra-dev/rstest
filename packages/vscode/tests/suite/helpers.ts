import assert from 'node:assert';
import type * as vscode from 'vscode';

export async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForConfigValue<T>({
  initialValue,
  read,
  expected,
  timeoutMs = 2000,
  pollMs = 25,
}: {
  initialValue: T;
  read: () => T;
  expected: T;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<T> {
  const start = Date.now();
  let value = initialValue;

  while (value !== expected && Date.now() - start < timeoutMs) {
    await delay(pollMs);
    value = read();
  }

  return value;
}

export function getTestItems(collection: vscode.TestItemCollection) {
  const items: vscode.TestItem[] = [];
  collection.forEach((item) => {
    items.push(item);
  });
  return items;
}

export function getProjectItems(testController: vscode.TestController) {
  const workspaces = getTestItems(testController.items);
  assert.equal(workspaces.length, 1);
  const projects = getTestItems(workspaces[0].children);
  assert.equal(projects.length, 1);
  return getTestItems(projects[0].children);
}
