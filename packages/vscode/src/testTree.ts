import { TextDecoder } from 'node:util';
import type { TestInfo } from '@rstest/core';
import vscode from 'vscode';
import { ROOT_SUITE_NAME } from '../../core/src/utils/constants';
import { logger } from './logger';
import type { RstestApi } from './master';
import type { Project, WorkspaceManager } from './project';

const textDecoder = new TextDecoder('utf-8');

export const testData = new WeakMap<
  vscode.TestItem,
  WorkspaceManager | Project | TestFolder | TestFile | TestCase
>();

export const getContentFromFilesystem = async (uri: vscode.Uri) => {
  try {
    const rawContent = await vscode.workspace.fs.readFile(uri);
    return textDecoder.decode(rawContent);
  } catch (e) {
    logger.warn(`Error providing tests for ${uri.fsPath}`, e);
    return '';
  }
};

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

export class TestFolder {
  constructor(
    public api: RstestApi,
    public uri: vscode.Uri,
  ) {}
}

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

  public updateFromList(tests: TestInfo[]) {
    const handleChild = (
      test: TestInfo,
      parent: vscode.TestItem[],
      parentNames: string[],
    ) => {
      // vscode location is zero based
      const line = (test.location?.line ?? 1) - 1;
      const column = (test.location?.column ?? 1) - 1;
      const range = new vscode.Range(line, column, line, column);
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
          handleChild(child, children, [...parentNames, test.name]);
        });
        testItem.children.replace(children);
      }
    };
    const children: vscode.TestItem[] = [];
    const realTests =
      tests[0]?.type === 'suite' && tests[0].name === ROOT_SUITE_NAME
        ? tests[0].tests
        : tests;
    realTests.forEach((test) => {
      handleChild(test, children, []);
    });
    this.children = children;
    this.testItem?.children.replace(this.children);
  }

  private onTest(
    range: vscode.Range,
    name: string,
    testType: 'test' | 'it' | 'suite' | 'describe',
    parent: vscode.TestItem[],
    parentNames: string[],
  ) {
    const siblingsCount = parent.filter((child) => child.label === name).length;

    // generate unique id to duplicated item
    let id = name;
    if (siblingsCount) id = [name, siblingsCount].join('@@@@@@');

    const isSuite = testType === 'describe' || testType === 'suite';

    const testItem = this.controller.createTestItem(id, name, this.uri);
    testData.set(
      testItem,
      new TestCase(this.api, this.uri, parentNames, isSuite ? 'suite' : 'case'),
    );

    testItem.range = range;

    // warn about duplicated name
    if (siblingsCount) testItem.error = `Duplicated ${testType} name`;

    // Set TestCase data for both describe blocks and leaf tests
    parent.push(testItem);

    return testItem;
  }
}

export class TestCase {
  constructor(
    public api: RstestApi,
    public uri: vscode.Uri,
    public parentNames: string[],
    public type: 'suite' | 'case',
  ) {}
}
