import { TextDecoder } from 'util';
import vscode from 'vscode';
import { RstestApi } from './master';
import { parseMarkdown } from './parser';
import { parseTestFile } from './parserTest';

const textDecoder = new TextDecoder('utf-8');

export type MarkdownTestData = TestFile | TestHeading | TestMdCase;

export const testData = new WeakMap<vscode.TestItem, MarkdownTestData>();

let generationCounter = 0;

export const getContentFromFilesystem = async (uri: vscode.Uri) => {
  try {
    const rawContent = await vscode.workspace.fs.readFile(uri);
    return textDecoder.decode(rawContent);
  } catch (e) {
    console.warn(`Error providing tests for ${uri.fsPath}`, e);
    return '';
  }
};

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
    const ancestors = [{ item, children: [] as vscode.TestItem[] }];
    const thisGeneration = generationCounter++;
    this.didResolve = true;

    const ascend = (depth: number) => {
      while (ancestors.length > depth) {
        const finished = ancestors.pop()!;
        finished.item.children.replace(finished.children);
      }
    };

    const isMd = item.uri?.fsPath.endsWith('.md');

    if (isMd) {
      parseMarkdown(content, {
        onTest: (range, a, operator, b, expected) => {
          const parent = ancestors[ancestors.length - 1];
          const data = new TestMdCase(
            a,
            operator as Operator,
            b,
            expected,
            thisGeneration,
          );
          const id = `${item.uri}/${data.getLabel()}`;

          const tcase = controller.createTestItem(
            id,
            data.getLabel(),
            item.uri,
          );
          testData.set(tcase, data);
          tcase.range = range;
          parent.children.push(tcase);
        },

        onHeading: (range, name, depth) => {
          ascend(depth);
          const parent = ancestors[ancestors.length - 1];
          const id = `${item.uri}/${name}`;

          const thead = controller.createTestItem(id, name, item.uri);
          thead.range = range;
          testData.set(thead, new TestHeading(thisGeneration));
          parent.children.push(thead);
          ancestors.push({ item: thead, children: [] });
        },
      });
    } else {
      parseTestFile(content, {
        onTest: (range, name, testType) => {
          const parent = ancestors[ancestors.length - 1];
          const testCase = new TestCase(thisGeneration, testType, range, name);
          const testItem = controller.createTestItem(
            testCase.getId(),
            testCase.getLabel(),
            item.uri,
          );
          testData.set(testItem, testCase);
          testItem.range = range;
          parent.children.push(testItem);
        },

        onHeading: (range, name, depth) => {},
      });
    }

    ascend(0); // finish and assign children for all remaining items
  }
}

export class TestHeading {
  constructor(public generation: number) {}
}

type Operator = '+' | '-' | '*' | '/';

export class TestMdCase {
  constructor(
    private readonly a: number,
    private readonly operator: Operator,
    private readonly b: number,
    private readonly expected: number,
    public generation: number,
  ) {}

  getLabel() {
    return `${this.a} ${this.operator} ${this.b} = ${this.expected}`;
  }

  async run(
    item: vscode.TestItem,
    options: vscode.TestRun,
    api: RstestApi,
  ): Promise<void> {
    const start = Date.now();
    await new Promise((resolve) =>
      setTimeout(resolve, 1000 + Math.random() * 1000),
    );
    const actual = this.evaluate();
    const duration = Date.now() - start;

    if (actual === this.expected) {
      options.passed(item, duration);
    } else {
      const message = vscode.TestMessage.diff(
        `Expected ${item.label}`,
        String(this.expected),
        String(actual),
      );
      message.location = new vscode.Location(item.uri!, item.range!);
      options.failed(item, message, duration);
    }
  }

  private evaluate() {
    switch (this.operator) {
      case '-':
        return this.a - this.b;
      case '+':
        return this.a + this.b;
      case '/':
        return Math.floor(this.a / this.b);
      case '*':
        return this.a * this.b;
    }
  }
}

export class TestCase {
  constructor(
    public generation: number,
    private method: string,
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
    options: vscode.TestRun,
    api: RstestApi,
  ): Promise<void> {
    const start = Date.now();

    // const actual = this.evaluate();
    const result = await api.runTest(item);
    console.log('🔴', result);
    const firstResult = result.testResults[0];
    const duration = Date.now() - start;
    if (firstResult.status === 'pass') {
      options.passed(item, duration);
    } else {
      options.failed(item, firstResult.errors[0], duration);
    }

    // if (actual === this.expected) {
    //   options.passed(item, duration);
    // } else {
    //   //   const message = vscode.TestMessage.diff(
    //   //     `Expected ${item.label}`,
    //   //     String(this.expected),
    //   //     String(actual),
    //   //   );
    //   //   message.location = new vscode.Location(item.uri!, item.range!);
    //   //   options.failed(item, message, duration);
    // }
  }
}
