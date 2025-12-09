import { TextDecoder } from 'node:util';
import vscode from 'vscode';
import { logger } from './logger';
import type { RstestApi } from './master';
import { parseTestFile } from './parserTest';

const textDecoder = new TextDecoder('utf-8');

export const testData = new WeakMap<vscode.TestItem, TestFile | TestCase>();

export const testItemType = new WeakMap<
  vscode.TestItem,
  'workspace' | 'project' | 'folder' | 'file' | 'suite' | 'case'
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

export class TestFile {
  public didResolve = false;

  constructor(private api: RstestApi) {}

  public async updateFromDisk(
    controller: vscode.TestController,
    item: vscode.TestItem,
  ) {
    try {
      const content = await getContentFromFilesystem(item.uri!);
      item.error = undefined;
      this.updateFromContents(controller, content, item);
    } catch (e) {
      item.error = (e as Error).stack;
    }
  }

  /**
   * Parses the tests from the input text, and updates the tests contained
   * by this file to be those from the text,
   */
  public updateFromContents(
    controller: vscode.TestController,
    content: string,
    item: vscode.TestItem,
  ) {
    // Maintain a stack of ancestors to build a hierarchical tree
    const ancestors = [{ item, children: [] as vscode.TestItem[] }];
    this.didResolve = true;

    parseTestFile(content, {
      onTest: (range, name, testType) => {
        const vscodeRange = new vscode.Range(
          new vscode.Position(range.startLine, range.startChar),
          new vscode.Position(range.endLine, range.endChar),
        );

        const parent = ancestors[ancestors.length - 1];

        const testCase = new TestCase(this.api);

        const siblingsCount = parent.children.filter(
          (child) => child.label === name,
        ).length;

        // generate unique id to duplicated item
        let id = name;
        if (siblingsCount) id = [name, siblingsCount].join('@@@@@@');

        const testItem = controller.createTestItem(id, name, item.uri);

        testItem.range = vscodeRange;

        // warn about duplicated name
        if (siblingsCount) testItem.error = `Duplicated ${testType} name`;

        // Set TestCase data for both describe blocks and leaf tests
        testData.set(testItem, testCase);
        parent.children.push(testItem);

        if (testType === 'describe' || testType === 'suite') {
          testItemType.set(testItem, 'suite');

          const suite = { item: testItem, children: [] };
          // This becomes the new parent for subsequently discovered children
          ancestors.push(suite);
          return () => {
            // Assign children to suite and pop from stack
            suite.item.children.replace(suite.children);
            ancestors.pop();
          };
        }

        testItemType.set(testItem, 'case');
      },
    });

    // Assign children to root item
    ancestors[0].item.children.replace(ancestors[0].children);
  }

  async run(
    item: vscode.TestItem,
    run: vscode.TestRun,
    updateSnapshot?: boolean,
    controller?: vscode.TestController,
  ): Promise<void> {
    if (!this.didResolve && controller) {
      await this.updateFromDisk(controller, item);
    }

    // Match messaging and behavior from extension.ts
    // run.appendOutput(`Running all tests in file ${item.id}\r\n`);

    try {
      await this.api.runTest(item, run, updateSnapshot);
    } catch (error: any) {
      run.failed(
        item,
        new vscode.TestMessage(
          `Error running file tests: ${error.message || String(error)}`,
        ),
      );
      // Skip all child tests in case of error
      for (const child of gatherTestItems(item.children)) {
        run.skipped(child);
      }
    }
  }
}

export class TestCase {
  constructor(private api: RstestApi) {}

  async run(
    item: vscode.TestItem,
    run: vscode.TestRun,
    updateSnapshot?: boolean,
  ): Promise<void> {
    try {
      await this.api.runTest(item, run, updateSnapshot);
    } catch (error: any) {
      run.failed(
        item,
        new vscode.TestMessage(
          `Error running test: ${error.message || String(error)}`,
        ),
      );
    }
  }
}
