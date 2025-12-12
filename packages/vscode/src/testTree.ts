import { TextDecoder } from 'node:util';
import vscode from 'vscode';
import { logger } from './logger';
import type { RstestApi } from './master';
import { parseTestFile } from './parserTest';
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
  ) {}

  public setTestItem(item: vscode.TestItem) {
    this.testItem = item;
    item.children.replace(this.children);
  }

  public async updateFromDisk(controller: vscode.TestController) {
    const content = await getContentFromFilesystem(this.uri);
    this.updateFromContents(controller, content);
  }

  /**
   * Parses the tests from the input text, and updates the tests contained
   * by this file to be those from the text,
   */
  public updateFromContents(
    controller: vscode.TestController,
    content: string,
  ) {
    // Maintain a stack of ancestors to build a hierarchical tree
    const ancestors: { name: string; children: vscode.TestItem[] }[] = [
      { name: 'ROOT', children: [] },
    ];
    this.didResolve = true;

    parseTestFile(content, {
      onTest: (range, name, testType) => {
        const vscodeRange = new vscode.Range(
          new vscode.Position(range.startLine, range.startChar),
          new vscode.Position(range.endLine, range.endChar),
        );

        const parent = ancestors[ancestors.length - 1];

        const siblingsCount = parent.children.filter(
          (child) => child.label === name,
        ).length;

        // generate unique id to duplicated item
        let id = name;
        if (siblingsCount) id = [name, siblingsCount].join('@@@@@@');

        const isSuite = testType === 'describe' || testType === 'suite';

        const testItem = controller.createTestItem(id, name, this.uri);
        testData.set(
          testItem,
          new TestCase(
            this.api,
            this.uri,
            ancestors.slice(1).map((item) => item.name),
            isSuite ? 'suite' : 'case',
          ),
        );

        testItem.range = vscodeRange;

        // warn about duplicated name
        if (siblingsCount) testItem.error = `Duplicated ${testType} name`;

        // Set TestCase data for both describe blocks and leaf tests
        parent.children.push(testItem);

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
}

export class TestCase {
  constructor(
    public api: RstestApi,
    public uri: vscode.Uri,
    public parentNames: string[],
    public type: 'suite' | 'case',
  ) {}
}
