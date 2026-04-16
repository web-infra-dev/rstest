import assert from 'node:assert';
import path from 'node:path';
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
    timeoutMs = 10_000,
    pollMs = 25,
  }: {
    timeoutMs?: number;
    pollMs?: number;
  } = {},
) {
  return new Promise<T>((resolve, reject) => {
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
  const folders = getTestItems(testController.items);
  assert.equal(folders.length, 1);
  return getTestItems(folders[0].children);
}

export function getTestItemByLabels(
  collection: vscode.TestItemCollection,
  labels: string[],
) {
  const item = labels.reduce(
    (item, label) =>
      item &&
      getTestItems(item.children).find((child) => child.label === label),
    {
      children: collection,
    } as vscode.TestItem | undefined,
  );
  assert.ok(item);
  return item;
}

// Helper: recursively transform a TestItem into a label-only tree.
// Children are sorted by label for stable comparisons.
export function toLabelTree(
  collection: vscode.TestItemCollection,
  fileOnly?: boolean,
): {
  label: string;
  children?: { label: string; children?: any[] }[];
}[] {
  const nodes: { label: string; children?: any[] }[] = [];
  collection.forEach((child) => {
    const children =
      child.label.match(/\.(test|spec)\.[cm]?[jt]sx?/) && fileOnly
        ? []
        : toLabelTree(child.children, fileOnly);
    // normalize to linux path style
    const label = child.label.replaceAll(path.sep, '/');
    nodes.push(children.length ? { label, children } : { label });
  });
  nodes.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return nodes;
}
