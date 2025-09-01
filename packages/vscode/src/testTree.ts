import { TextDecoder } from 'node:util';
import vscode from 'vscode';
import type { RstestApi } from './master';
import { parseTestFile } from './parserTest';
import { logger } from './logger';
import { getWorkspaceTestPatterns, shouldIgnorePath } from './utils';

const textDecoder = new TextDecoder('utf-8');

export const testData = new WeakMap<vscode.TestItem, TestFile | TestCase>();

let generationCounter = 0;

export const getContentFromFilesystem = async (uri: vscode.Uri) => {
  try {
    const rawContent = await vscode.workspace.fs.readFile(uri);
    return textDecoder.decode(rawContent);
  } catch (e) {
    logger.warn(`Error providing tests for ${uri.fsPath}`, e);
    return '';
  }
};

export function gatherTestItems(collection: vscode.TestItemCollection) {
  const items: vscode.TestItem[] = [];
  collection.forEach((item) => {
    items.push(item);
    if (item.children.size > 0) {
      gatherTestItems(item.children).forEach((child) => {
        items.push(child);
      });
    }
  });
  return items;
}

/**
 * Scans the workspace for all test files and ensures they exist as root
 * TestItems on the provided controller. Also parses their contents so the
 * initial tree includes discovered tests without requiring files to open.
 */
export async function scanAllTestFiles(
  controller: vscode.TestController,
): Promise<void> {
  const patterns = getWorkspaceTestPatterns();
  if (!patterns.length) return;

  const uris = new Set<string>();

  // Collect and dedupe all matching files across workspace folders
  for (const { pattern } of patterns) {
    const found = await vscode.workspace.findFiles(pattern);
    for (const f of found) {
      const shouldIgnore = shouldIgnorePath(f.fsPath);
      if (!shouldIgnore) {
        uris.add(f.toString());
      }
    }
  }

  const tasks: Promise<void>[] = [];

  for (const uriStr of uris) {
    const uri = vscode.Uri.parse(uriStr);
    let item = controller.items.get(uriStr);
    let fileData: TestFile | undefined;

    if (!item) {
      item = controller.createTestItem(
        uriStr,
        uri.path.split('/').pop() || uriStr,
        uri,
      );
      controller.items.add(item);
      fileData = new TestFile();
      testData.set(item, fileData);
      item.canResolveChildren = true;
    } else {
      const data = testData.get(item);
      if (data instanceof TestFile) {
        fileData = data;
      } else {
        fileData = new TestFile();
        testData.set(item, fileData);
      }
    }

    // Parse immediately so children are available in the tree
    tasks.push(fileData.updateFromDisk(controller, item));
  }

  await Promise.all(tasks);
}

export class TestFile {
  public didResolve = false;

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
    const thisGeneration = generationCounter++;
    this.didResolve = true;

    const ascend = (depth: number) => {
      while (ancestors.length > depth) {
        const finished = ancestors.pop()!;
        finished.item.children.replace(finished.children);
      }
    };

    const contains = (outer: vscode.Range | undefined, inner: vscode.Range) =>
      !outer || outer.contains(inner);

    parseTestFile(content, {
      onTest: (range, name, testType) => {
        const vscodeRange = new vscode.Range(
          new vscode.Position(range.startLine, range.startChar),
          new vscode.Position(range.endLine, range.endChar),
        );

        // Adjust the ancestor stack based on source nesting using ranges
        while (ancestors.length > 1) {
          const last = ancestors[ancestors.length - 1].item;
          if (contains(last.range, vscodeRange)) {
            break;
          }
          const finished = ancestors.pop()!;
          finished.item.children.replace(finished.children);
        }

        const parent = ancestors[ancestors.length - 1];

        const testCase = new TestCase(
          thisGeneration,
          testType,
          vscodeRange,
          name,
        );

        const testItem = controller.createTestItem(
          testCase.getId(),
          testCase.getLabel(),
          item.uri,
        );
        testItem.range = vscodeRange;

        // Set TestCase data for both describe blocks and leaf tests
        testData.set(testItem, testCase);
        parent.children.push(testItem);

        if (testType === 'describe' || testType === 'suite') {
          // This becomes the new parent for subsequently discovered children
          ancestors.push({ item: testItem, children: [] });
        }
      },
    });

    ascend(0); // finish and assign children for all remaining items
  }

  async run(
    item: vscode.TestItem,
    run: vscode.TestRun,
    api: RstestApi,
    controller?: vscode.TestController,
  ): Promise<void> {
    if (!this.didResolve && controller) {
      await this.updateFromDisk(controller, item);
    }

    // Match messaging and behavior from extension.ts
    run.appendOutput(`Running all tests in file ${item.id}\r\n`);

    try {
      const rstestResults = await api.runFileTests(item);

      // Process results for each child test item
      const testItems = gatherTestItems(item.children);
      for (const testItem of testItems) {
        const itemData = testData.get(testItem);
        if (itemData instanceof TestCase) {
          // Find matching result in rstestResults.testResults by name or parent
          const testResult = rstestResults?.testResults.find(
            (result) =>
              result.name === testItem.label ||
              (Array.isArray(result.parentNames) &&
                (result.parentNames as string[]).includes(
                  testItem.label as string,
                )),
          );

          if (testResult) {
            run.started(testItem);

            if (testResult.status === 'pass') {
              run.passed(testItem, testResult.duration || 0);
            } else if (testResult.status === 'skip') {
              run.skipped(testItem);
            } else if (
              testResult.status === 'fail' &&
              testResult.errors?.length
            ) {
              run.failed(
                testItem,
                new vscode.TestMessage(
                  testResult.errors[0].message || 'Test failed',
                ),
                testResult.duration || 0,
              );
            } else {
              // Handle other statuses (todo, etc.)
              run.skipped(testItem);
            }

            run.appendOutput(`Completed ${testItem.id}\r\n`);
          } else {
            // No result found for this test item
            run.skipped(testItem);
          }
        }
      }

      // Mark the file test as passed if no test failed
      if (
        rstestResults &&
        !rstestResults.testResults.some((result) => result.status === 'fail')
      ) {
        // Calculate total duration from all test results
        const totalDuration = rstestResults.testResults.reduce(
          (sum, result) => sum + (result.duration || 0),
          0,
        );
        run.passed(item, totalDuration);
      } else if (rstestResults) {
        // Calculate total duration from all test results
        const totalDuration = rstestResults.testResults.reduce(
          (sum, result) => sum + (result.duration || 0),
          0,
        );
        run.failed(
          item,
          new vscode.TestMessage('Some tests in this file failed'),
          totalDuration,
        );
      } else {
        run.failed(
          item,
          new vscode.TestMessage('No results returned for this file'),
        );
      }
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
  constructor(
    public generation: number,
    public testType: string,
    private range: vscode.Range,
    private name: string,
  ) {}

  getId() {
    return `${this.name} ${this.range.start.line}:${this.range.start.character}-${this.range.end.line}:${this.range.end.character}`;
  }

  getLabel() {
    return this.name;
  }

  async run(
    item: vscode.TestItem,
    run: vscode.TestRun,
    api: RstestApi,
  ): Promise<void> {
    // Match messaging and behavior from extension.ts
    run.appendOutput(`Running test case ${item.id}\r\n`);

    try {
      const rstestResults = await api.runTest(item);

      if (rstestResults && rstestResults.testResults.length > 0) {
        // Collect descendants to update individually
        const descendants = gatherTestItems(item.children);

        // Helper: collect ancestor labels recursively to the root (skip file nodes)
        const getAncestorLabels = (ti: vscode.TestItem): string[] => {
          if (!ti.parent) return [];
          const parentLabels = getAncestorLabels(ti.parent);
          if (
            typeof ti.parent.label === 'string' &&
            !ti.parent.id.startsWith('file://')
          ) {
            return [...parentLabels, ti.parent.label];
          }
          return parentLabels;
        };

        let totalDuration = 0;
        let anyFailed = false;

        // Iterate every result and set status for its matching VS Code item
        for (const result of rstestResults.testResults) {
          let match: vscode.TestItem | undefined;
          // Prefer exact descendant match by name and ancestors
          for (const d of descendants) {
            if (d.label === result.name) {
              const parents = Array.isArray(result.parentNames)
                ? (result.parentNames as string[])
                : [];
              const ancestors = getAncestorLabels(d);
              const fits = parents.every((p) => ancestors.includes(p));
              if (fits) {
                match = d;
                break;
              }
            }
          }

          // If no descendant matched and this refers to the parent case
          if (!match && result.name === item.label) {
            match = item;
          }

          if (match) {
            run.started(match);
            totalDuration += result.duration || 0;
            if (result.status === 'pass') {
              run.passed(match, result.duration || 0);
            } else if (result.status === 'skip') {
              run.skipped(match);
            } else if (result.status === 'fail' && result.errors?.length) {
              anyFailed = true;
              run.failed(
                match,
                new vscode.TestMessage(
                  result.errors[0].message || 'Test failed',
                ),
                result.duration || 0,
              );
            } else {
              run.skipped(match);
            }
          }
        }

        // Mark any descendant with no explicit result as skipped
        for (const d of descendants) {
          const hadResult = rstestResults.testResults.some(
            (r: any) => r.name === d.label,
          );
          if (!hadResult) {
            run.skipped(d);
          }
        }

        // If parent has no explicit result, aggregate by children
        const parentHasExplicit = rstestResults.testResults.some(
          (r: any) => r.name === item.label,
        );
        if (!parentHasExplicit) {
          if (anyFailed) {
            run.failed(
              item,
              new vscode.TestMessage('Some sub-tests in this case failed'),
              totalDuration,
            );
          } else {
            run.passed(item, totalDuration);
          }
        }
      } else {
        run.failed(
          item,
          new vscode.TestMessage('No results returned for this test'),
        );
      }
    } catch (error: any) {
      run.failed(
        item,
        new vscode.TestMessage(
          `Error running test: ${error.message || String(error)}`,
        ),
      );
      // Skip all child tests in case of error
      if (item.children.size > 0) {
        for (const child of gatherTestItems(item.children)) {
          run.skipped(child);
        }
      }
    }
  }
}
