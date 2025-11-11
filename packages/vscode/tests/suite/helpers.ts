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

export function waitFor<T = void>(
  cb: () => T,
  {
    timeoutMs = 2000,
    pollMs = 25,
  }: {
    timeoutMs?: number;
    pollMs?: number;
  } = {},
) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      try {
        resolve(cb());
        clearInterval(interval);
      } catch (error) {
        if (Date.now() - start > timeoutMs) {
          reject(error);
          clearInterval(interval);
        }
      }
    }, pollMs);
  });
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

// Helper: recursively transform a TestItem into a label-only tree.
// Children are sorted by label for stable comparisons.
export function toLabelTree(
  collection: vscode.TestItemCollection,
  maxDepth = Number.POSITIVE_INFINITY,
): {
  label: string;
  children?: { label: string; children?: any[] }[];
}[] {
  if (maxDepth === 0) return [];
  const nodes: { label: string; children?: any[] }[] = [];
  collection.forEach((child) => {
    const children = toLabelTree(child.children, maxDepth - 1);
    nodes.push(
      children.length
        ? { label: child.label, children }
        : { label: child.label },
    );
  });
  nodes.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return nodes;
}
