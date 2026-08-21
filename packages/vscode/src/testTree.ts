import { TextDecoder } from 'node:util';
import type { TestInfo } from '@rstest/core';
import type { ListedTest } from '@rstest/core/api';
import vscode from 'vscode';
import { ROOT_SUITE_NAME } from '../../core/src/utils/constants';
import { logger } from './logger';
import type { RstestApi } from './master';
import type { Project, WorkspaceManager } from './project';

const textDecoder = new TextDecoder('utf-8');

export const testData = new WeakMap<
  vscode.TestItem,
  WorkspaceManager | Project | TestFolder | ProjectFolder | TestFile | TestCase
>();

const getContentFromFilesystem = async (uri: vscode.Uri) => {
  try {
    const rawContent = await vscode.workspace.fs.readFile(uri);
    return textDecoder.decode(rawContent);
  } catch (e) {
    logger.warn(`Error providing tests for ${uri.fsPath}`, e);
    return '';
  }
};

// Duplicate sibling test/suite names get a unique TestItem id by appending
// their 0-based occurrence index. Creation (TestFile.onTest) and result lookup
// (TestRunReporter.findTestItem) must derive ids identically, so both go
// through this helper. `siblingIndex` is the number of prior same-named
// siblings (0 for the first, which keeps its plain name as id).
export function getTestItemId(name: string, siblingIndex: number): string {
  return siblingIndex ? [name, siblingIndex].join('@@@@@@') : name;
}

// Occurrence index of `name` among the siblings already collected in `parent`
// (0 for the first). Shared by tree creation and the range snapshot so both
// derive the same duplicate-aware id via getTestItemId.
function siblingIndexOf(parent: vscode.TestItem[], name: string): number {
  return parent.filter((child) => child.label === name).length;
}

export function gatherTestItems(
  collection: vscode.TestItemCollection,
  recursive = true,
) {
  const items: vscode.TestItem[] = [];
  collection.forEach((item) => {
    items.push(item);
    if (recursive && item.children.size > 0) {
      gatherTestItems(item.children).forEach((child) => {
        items.push(child);
      });
    }
  });
  return items;
}

export const groupListedTestsByFile = (
  tests: ListedTest[],
  requestedFiles: string[] = [],
): Array<{ uri: vscode.Uri; tests: ListedTest[] }> => {
  const byFile = new Map<string, ListedTest[]>(
    requestedFiles.map((file) => [file, []]),
  );
  for (const test of tests) {
    const entries = byFile.get(test.file) ?? [];
    entries.push(test);
    byFile.set(test.file, entries);
  }
  return Array.from(byFile, ([file, entries]) => ({
    uri: vscode.Uri.file(file),
    tests: entries,
  }));
};

export class TestFolder {
  constructor(
    public api: RstestApi,
    public uri: vscode.Uri,
  ) {}
}

// Marker for a folder node that groups multiple projects by directory. Unlike
// `TestFolder`, it does not belong to a single project/api, so running it
// recurses into its children instead of invoking one api.
export class ProjectFolder {}

export class TestFile {
  public didResolve = false;
  public testItem?: vscode.TestItem;
  private children: vscode.TestItem[] = [];

  constructor(
    public api: RstestApi,
    public uri: vscode.Uri,
    private controller: vscode.TestController,
  ) {}

  public setTestItem(item: vscode.TestItem) {
    this.testItem = item;
    item.children.replace(this.children);
  }

  public async updateFromDisk() {
    const content = await getContentFromFilesystem(this.uri);
    this.updateFromContents(content);
  }

  /**
   * Parses the tests from the input text, and updates the tests contained
   * by this file to be those from the text,
   */
  private async updateFromContents(content: string) {
    // Maintain a stack of ancestors to build a hierarchical tree
    const ancestors: { name: string; children: vscode.TestItem[] }[] = [
      { name: 'ROOT', children: [] },
    ];
    this.didResolve = true;

    const { parseTestFile } = await import('./parserTest');
    parseTestFile(content, {
      onTest: (range, name, testType) => {
        const vscodeRange = new vscode.Range(
          new vscode.Position(range.startLine, range.startChar),
          new vscode.Position(range.endLine, range.endChar),
        );

        const parent = ancestors[ancestors.length - 1];

        const parentNames = ancestors.slice(1).map((item) => item.name);

        const testItem = this.onTest(
          vscodeRange,
          name,
          testType,
          parent.children,
          parentNames,
        );

        const isSuite = testType === 'describe' || testType === 'suite';

        testData.set(
          testItem,
          new TestCase(
            this.api,
            this.uri,
            parentNames,
            isSuite ? 'suite' : 'case',
          ),
        );

        if (isSuite) {
          const children: vscode.TestItem[] = [];
          // This becomes the new parent for subsequently discovered children
          ancestors.push({ name, children: children });
          return () => {
            // Assign children to suite and pop from stack
            testItem.children.replace(children);
            ancestors.pop();
          };
        }
      },
    });
    this.children = ancestors[0].children;
    this.testItem?.children.replace(this.children);
  }

  public updateFromList(tests: TestInfo[] | ListedTest[]) {
    const listedTests = tests.filter(isListedTest);
    if (listedTests.length) {
      // A file has one VS Code URI even when several projects collect it.
      // Render one declaration tree instead of merging the project copies.
      const firstProject = listedTests[0].project;
      this.updateFromListedTests(
        listedTests.filter((test) => test.project === firstProject),
      );
      return;
    }
    const testInfos = tests.filter(
      (test): test is TestInfo => !isListedTest(test),
    );

    // A run's reported tests may arrive without a source location (the runtime
    // only emits locations when `includeTaskLocation` resolves one, which
    // depends on the project's core version and build). Snapshot the ranges we
    // already have so a location-less test keeps its range instead of
    // collapsing to line 1, which would move every gutter icon to the imports.
    // Keys are the path of duplicate-aware item ids so that duplicate sibling
    // names each keep their own range.
    const previousRanges = new Map<string, vscode.Range>();
    const rangeKey = (idPath: string[]) => idPath.join('\x00');
    const snapshot = (item: vscode.TestItem, idPath: string[]) => {
      if (item.range) previousRanges.set(rangeKey(idPath), item.range);
      item.children.forEach((child) => snapshot(child, [...idPath, child.id]));
    };
    this.children.forEach((item) => snapshot(item, [item.id]));

    const handleChild = (
      test: TestInfo,
      parent: vscode.TestItem[],
      parentNames: string[],
      parentIds: string[],
    ) => {
      const names = [...parentNames, test.name];
      const ids = [
        ...parentIds,
        getTestItemId(test.name, siblingIndexOf(parent, test.name)),
      ];
      let range: vscode.Range | undefined;
      if (test.location) {
        // vscode location is zero based
        const line = test.location.line - 1;
        const column = test.location.column - 1;
        range = new vscode.Range(line, column, line, column);
      } else {
        range = previousRanges.get(rangeKey(ids));
      }
      const testItem = this.onTest(
        range,
        test.name,
        test.type === 'suite' ? 'suite' : 'test',
        parent,
        parentNames,
      );
      if (test.type === 'suite') {
        const children: vscode.TestItem[] = [];
        test.tests.forEach((child) => {
          handleChild(child, children, names, ids);
        });
        testItem.children.replace(children);
      }
    };
    const children: vscode.TestItem[] = [];
    const realTests =
      testInfos[0]?.type === 'suite' && testInfos[0].name === ROOT_SUITE_NAME
        ? testInfos[0].tests
        : testInfos;
    realTests.forEach((test) => {
      handleChild(test, children, [], []);
    });
    this.children = children;
    this.testItem?.children.replace(this.children);
  }

  private updateFromListedTests(tests: ListedTest[]): void {
    const previousRanges = new Map<string, vscode.Range>();
    const rangeKey = (idPath: string[]) => idPath.join('\x00');
    const snapshot = (item: vscode.TestItem, idPath: string[]) => {
      if (item.range) previousRanges.set(rangeKey(idPath), item.range);
      item.children.forEach((child) => snapshot(child, [...idPath, child.id]));
    };
    this.children.forEach((item) => snapshot(item, [item.id]));

    type Parent = {
      names: string[];
      ids: string[];
      children: vscode.TestItem[];
      item?: vscode.TestItem;
    };
    const root: Parent = { names: [], ids: [], children: [] };
    const parents: Parent[] = [root];
    const finalizeParent = (): void => {
      const parent = parents.pop()!;
      parent.item?.children.replace(parent.children);
    };

    for (const test of tests) {
      const parentNames = test.parentNames ?? [];
      while (
        parents.length > 1 &&
        parents.at(-1)!.names.join('\x00') !== parentNames.join('\x00')
      ) {
        finalizeParent();
      }
      const parent = parents.at(-1)!;
      const taskName = test.taskName ?? test.name;
      if (!taskName) continue;
      const id = getTestItemId(
        taskName,
        siblingIndexOf(parent.children, taskName),
      );
      const ids = [...parent.ids, id];
      const location = test.location;
      const range = location
        ? new vscode.Range(
            location.line - 1,
            location.column - 1,
            location.line - 1,
            location.column - 1,
          )
        : previousRanges.get(rangeKey(ids));
      const testItem = this.onTest(
        range,
        taskName,
        test.type === 'suite' ? 'suite' : 'test',
        parent.children,
        parentNames,
      );
      testItem.description = test.runMode;

      if (test.type === 'suite') {
        const children: vscode.TestItem[] = [];
        parents.push({
          names: [...parentNames, taskName],
          ids,
          children,
          item: testItem,
        });
      }
    }

    while (parents.length > 1) {
      finalizeParent();
    }

    this.children = root.children;
    this.testItem?.children.replace(this.children);
  }

  private onTest(
    range: vscode.Range | undefined,
    name: string,
    testType: 'test' | 'it' | 'suite' | 'describe',
    parent: vscode.TestItem[],
    parentNames: string[],
  ) {
    const siblingsCount = siblingIndexOf(parent, name);

    const id = getTestItemId(name, siblingsCount);

    const isSuite = testType === 'describe' || testType === 'suite';

    const testItem = this.controller.createTestItem(id, name, this.uri);
    testData.set(
      testItem,
      new TestCase(this.api, this.uri, parentNames, isSuite ? 'suite' : 'case'),
    );

    if (range) testItem.range = range;

    // warn about duplicated name
    if (siblingsCount) testItem.error = `Duplicated ${testType} name`;

    // Set TestCase data for both describe blocks and leaf tests
    parent.push(testItem);

    return testItem;
  }
}

const isListedTest = (test: TestInfo | ListedTest): test is ListedTest =>
  'file' in test;

export class TestCase {
  constructor(
    public api: RstestApi,
    public uri: vscode.Uri,
    public parentNames: string[],
    public type: 'suite' | 'case',
  ) {}
}
