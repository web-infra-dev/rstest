import { describe, expect, it, rs } from '@rstest/core';

rs.mock('vscode', () => {
  class Range {
    constructor(
      public startLine: number,
      public startChar: number,
      public endLine: number,
      public endChar: number,
    ) {}
  }
  const channel = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    appendLine: () => {},
    dispose: () => {},
  };
  const vscode = {
    Range,
    Uri: {
      file: (fsPath: string) => ({
        fsPath,
        toString: () => `file://${fsPath}`,
      }),
    },
    window: { createOutputChannel: () => channel },
    workspace: { fs: {} },
  };
  return { ...vscode, default: vscode };
});

const makeCollection = () => {
  const map = new Map<string, any>();
  return {
    replace: (items: any[]) => {
      map.clear();
      for (const item of items) map.set(item.id, item);
    },
    forEach: (cb: (item: any) => void) => map.forEach((v) => cb(v)),
    get: (id: string) => map.get(id),
    get size() {
      return map.size;
    },
  };
};

const createController = () =>
  ({
    createTestItem: (id: string, label: string, uri: unknown) => ({
      id,
      label,
      uri,
      range: undefined as any,
      error: undefined as any,
      children: makeCollection(),
    }),
  }) as any;

const location = (line: number) => ({ line, column: 3 });

// suite "outer" @ line 7, cases "a" @ 12 and "b" @ 16 (1-based, like core)
const withLocations = [
  {
    type: 'suite',
    name: 'outer',
    location: location(7),
    tests: [
      { type: 'case', name: 'a', location: location(12), tests: [] },
      { type: 'case', name: 'b', location: location(16), tests: [] },
    ],
  },
] as any;

const withoutLocations = [
  {
    type: 'suite',
    name: 'outer',
    location: undefined,
    tests: [
      { type: 'case', name: 'a', location: undefined, tests: [] },
      { type: 'case', name: 'b', location: undefined, tests: [] },
    ],
  },
] as any;

describe('TestFile.updateFromList', () => {
  it('keeps existing ranges when a rebuilt test reports no location', async () => {
    const { TestFile } = await import('../../src/testTree');
    const controller = createController();
    const uri = { fsPath: '/x/outer.test.ts', toString: () => 'file:///x' };
    const file = new TestFile({} as any, uri as any, controller);
    const root = controller.createTestItem('root', 'outer.test.ts', uri);
    file.setTestItem(root);

    // Discovery-like pass with real source locations.
    file.updateFromList(withLocations);
    const suite1 = root.children.get('outer');
    expect(suite1.range.startLine).toBe(6);
    expect(suite1.children.get('a').range.startLine).toBe(11);
    expect(suite1.children.get('b').range.startLine).toBe(15);

    // A run reports the same tests without locations; ranges must survive
    // instead of collapsing to line 1.
    file.updateFromList(withoutLocations);
    const suite2 = root.children.get('outer');
    expect(suite2.range.startLine).toBe(6);
    expect(suite2.children.get('a').range.startLine).toBe(11);
    expect(suite2.children.get('b').range.startLine).toBe(15);
  });

  it('uses the reported location when one is present', async () => {
    const { TestFile } = await import('../../src/testTree');
    const controller = createController();
    const uri = { fsPath: '/x/outer.test.ts', toString: () => 'file:///x' };
    const file = new TestFile({} as any, uri as any, controller);
    file.setTestItem(controller.createTestItem('root', 'outer.test.ts', uri));

    file.updateFromList(withLocations);
    file.updateFromList([
      {
        type: 'suite',
        name: 'outer',
        location: location(9),
        tests: [{ type: 'case', name: 'a', location: location(20), tests: [] }],
      },
    ] as any);

    const root = (file as any).testItem;
    const suite = root.children.get('outer');
    expect(suite.range.startLine).toBe(8);
    expect(suite.children.get('a').range.startLine).toBe(19);
  });
});
