import { TextDecoder } from 'node:util';
import type { TestResult } from '@rstest/core';
import vscode from 'vscode';
import { logger } from './logger';
import type { RstestApi } from './master';
import { parseTestFile } from './parserTest';

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

const getAncestorLabels = (item: vscode.TestItem): string[] => {
  const labels: string[] = [];
  let current = item.parent;
  while (current) {
    if (
      typeof current.label === 'string' &&
      !current.id.startsWith('file://')
    ) {
      labels.unshift(current.label);
    }
    current = current.parent;
  }
  return labels;
};

type CaseNodeStatus = 'pass' | 'fail' | 'skip';

type CaseNode = {
  item: vscode.TestItem;
  ancestors: string[];
  children: CaseNode[];
  parent?: CaseNode;
  directResult?: TestResult;
  status?: CaseNodeStatus;
  duration: number;
};

type ApplyResultsOptions = {
  includeRoot: boolean;
  aggregateFailureMessage: string;
};

type ApplyResultsSummary = {
  totalDuration: number;
  anyFailed: boolean;
  rootHadDirectResult: boolean;
  matchedResultCount: number;
  unmatchedResultNames: string[];
  failedNodeCount: number;
  totalNodeCount: number;
};

const applyResultsToTestCases = (
  root: vscode.TestItem,
  run: vscode.TestRun,
  results: TestResult[],
  options: ApplyResultsOptions,
): ApplyResultsSummary => {
  const startedItems = new Set<vscode.TestItem>();
  const ensureStarted = (item: vscode.TestItem) => {
    if (!startedItems.has(item)) {
      run.started(item);
      startedItems.add(item);
    }
  };

  const candidateItems = options.includeRoot
    ? [root, ...gatherTestItems(root.children)]
    : gatherTestItems(root.children);

  const nodes: CaseNode[] = [];
  const nodeByItem = new Map<vscode.TestItem, CaseNode>();
  let matchedResultCount = 0;
  const unmatchedResultNames: string[] = [];

  for (const item of candidateItems) {
    const data = testData.get(item);
    if (!(data instanceof TestCase)) continue;
    const node: CaseNode = {
      item,
      ancestors: getAncestorLabels(item),
      children: [],
      duration: 0,
    };
    nodes.push(node);
    nodeByItem.set(item, node);
  }

  for (const node of nodes) {
    const parentItem = node.item.parent;
    if (!parentItem) continue;
    const parentNode = nodeByItem.get(parentItem);
    if (parentNode) {
      node.parent = parentNode;
      parentNode.children.push(node);
    }
  }

  const matchesParents = (node: CaseNode, parentNames: string[]): boolean => {
    if (node.ancestors.length !== parentNames.length) {
      return false;
    }
    return node.ancestors.every((label, index) => label === parentNames[index]);
  };

  for (const result of results) {
    const parentNames = Array.isArray(result.parentNames)
      ? (result.parentNames as string[])
      : [];
    let match: CaseNode | undefined;
    for (const node of nodes) {
      if (
        node.item.label === result.name &&
        matchesParents(node, parentNames)
      ) {
        match = node;
        break;
      }
    }
    if (match) {
      match.directResult = result;
      matchedResultCount++;
    } else if (result.name) {
      unmatchedResultNames.push(result.name);
    }
  }

  const sortedNodes = [...nodes].sort(
    (a, b) => b.ancestors.length - a.ancestors.length,
  );

  let totalDuration = 0;
  let anyFailed = false;

  for (const node of sortedNodes) {
    const { directResult } = node;
    if (directResult) {
      const duration = directResult.duration || 0;
      ensureStarted(node.item);

      if (directResult.status === 'pass') {
        run.passed(node.item, duration);
        node.status = 'pass';
      } else if (directResult.status === 'skip') {
        run.skipped(node.item);
        node.status = 'skip';
      } else if (
        directResult.status === 'fail' &&
        directResult.errors?.length
      ) {
        anyFailed = true;
        run.failed(
          node.item,
          new vscode.TestMessage(
            directResult.errors[0].message || 'Test failed',
          ),
          duration,
        );
        node.status = 'fail';
      } else if (directResult.status === 'fail') {
        anyFailed = true;
        run.failed(node.item, new vscode.TestMessage('Test failed'), duration);
        node.status = 'fail';
      } else {
        run.skipped(node.item);
        node.status = 'skip';
      }

      run.appendOutput(`Completed ${node.item.id}\r\n`);
      node.duration = duration;
      if (node.status === 'fail') {
        anyFailed = true;
      }
      totalDuration += duration;
      continue;
    }

    if (node.children.length === 0) {
      ensureStarted(node.item);
      run.skipped(node.item);
      node.status = 'skip';
      node.duration = 0;
      continue;
    }

    let aggregatedDuration = 0;
    let childFailed = false;
    let childHasStatus = false;

    for (const child of node.children) {
      aggregatedDuration += child.duration;
      if (child.status) {
        childHasStatus = true;
      }
      if (child.status === 'fail') {
        childFailed = true;
      }
    }

    if (!childHasStatus) {
      ensureStarted(node.item);
      run.skipped(node.item);
      node.status = 'skip';
      node.duration = aggregatedDuration;
      continue;
    }

    ensureStarted(node.item);
    node.duration = aggregatedDuration;

    if (childFailed) {
      anyFailed = true;
      run.failed(
        node.item,
        new vscode.TestMessage(options.aggregateFailureMessage),
        aggregatedDuration,
      );
      node.status = 'fail';
    } else {
      run.passed(node.item, aggregatedDuration);
      node.status = 'pass';
    }
  }

  const rootNode = options.includeRoot ? nodeByItem.get(root) : undefined;
  const rootHadDirectResult = Boolean(rootNode?.directResult);
  const failedNodeCount = nodes.filter((node) => node.status === 'fail').length;

  return {
    totalDuration,
    anyFailed,
    rootHadDirectResult,
    matchedResultCount,
    unmatchedResultNames,
    failedNodeCount,
    totalNodeCount: nodes.length,
  };
};

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
          this.api,
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
    controller?: vscode.TestController,
  ): Promise<void> {
    if (!this.didResolve && controller) {
      await this.updateFromDisk(controller, item);
    }

    // Match messaging and behavior from extension.ts
    run.appendOutput(`Running all tests in file ${item.id}\r\n`);

    try {
      const rstestResults = await this.api.runFileTests(item);

      const results = rstestResults?.testResults ?? [];
      const {
        totalDuration,
        anyFailed,
        matchedResultCount,
        unmatchedResultNames,
        failedNodeCount,
        totalNodeCount,
      } = applyResultsToTestCases(item, run, results, {
        includeRoot: false,
        aggregateFailureMessage: 'Some nested tests failed',
      });

      logger.debug('Applied file test results', {
        fileId: item.id,
        totalNodeCount,
        matchedResultCount,
        unmatchedResultCount: unmatchedResultNames.length,
        unmatchedResultSample: unmatchedResultNames.slice(0, 3),
        failedNodeCount,
        totalDuration,
      });

      // Mark the file test as passed if no test failed
      if (rstestResults && !anyFailed) {
        run.passed(item, totalDuration);
      } else if (rstestResults) {
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
    private api: RstestApi,
  ) {}

  getId() {
    return `${this.name} ${this.range.start.line}:${this.range.start.character}-${this.range.end.line}:${this.range.end.character}`;
  }

  getLabel() {
    return this.name;
  }

  async run(item: vscode.TestItem, run: vscode.TestRun): Promise<void> {
    // Match messaging and behavior from extension.ts
    run.appendOutput(`Running test case ${item.id}\r\n`);

    try {
      const rstestResults = await this.api.runTest(item);

      if (rstestResults && rstestResults.testResults.length > 0) {
        const {
          totalDuration,
          matchedResultCount,
          unmatchedResultNames,
          failedNodeCount,
          totalNodeCount,
          rootHadDirectResult,
        } = applyResultsToTestCases(item, run, rstestResults.testResults, {
          includeRoot: true,
          aggregateFailureMessage: 'Some sub-tests in this case failed',
        });

        logger.debug('Applied case test results', {
          testId: item.id,
          totalNodeCount,
          matchedResultCount,
          unmatchedResultCount: unmatchedResultNames.length,
          unmatchedResultSample: unmatchedResultNames.slice(0, 3),
          failedNodeCount,
          totalDuration,
          rootHadDirectResult,
        });
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
