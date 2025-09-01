import { Compiler } from '@swc/core';
import * as vscode from 'vscode';

export const parseTestFile = (
  code: string,
  events: {
    onTest(
      range: vscode.Range,
      name: string,
      testType:
        | 'test'
        | 'it'
        | 'describe'
        | 'beforeEach'
        | 'afterEach'
        | 'beforeAll'
        | 'afterAll',
    ): void;
    onHeading(range: vscode.Range, name: string, depth: number): void;
  },
) => {
  const compiler = new Compiler();

  // Parse the code using SWC
  const ast = compiler.parseSync(code, {
    syntax: 'typescript',
    tsx: true,
  });

  const offset = ast.span.start - 1;

  // Helper function to convert SWC span to VS Code range
  const spanToRange = (span: { start: number; end: number }): vscode.Range => {
    const lines = code.substring(0, span.start - offset).split('\n');
    const startLine = lines.length - 1;
    const startChar = lines[startLine].length;

    const endLines = code.substring(0, span.end - offset).split('\n');
    const endLine = endLines.length - 1;
    const endChar = endLines[endLine].length;

    return new vscode.Range(
      new vscode.Position(startLine, startChar),
      new vscode.Position(endLine, endChar),
    );
  };

  // Common test function names to detect
  const testFunctions = new Set([
    'test',
    'it',
    'describe',
    'beforeEach',
    'afterEach',
    'beforeAll',
    'afterAll',
    'suite',
    'context',
  ]);

  // Helper function to extract string literal value
  const getStringLiteralValue = (node: any): string | null => {
    if (!node) return null;

    if (node.type === 'StringLiteral') {
      return node.value;
    }
    if (node.type === 'TemplateLiteral') {
      // For simple template literals without expressions
      if (
        node.quasis?.length === 1 &&
        (!node.expressions || node.expressions.length === 0)
      ) {
        return node.quasis[0].cooked || node.quasis[0].raw;
      }
      // For template literals with expressions, construct the string
      let result = '';
      for (let i = 0; i < node.quasis.length; i++) {
        result += node.quasis[i].cooked || node.quasis[i].raw || '';
        if (i < node.expressions.length) {
          result += '$' + '{...}'; // Placeholder for expressions
        }
      }
      return result;
    }

    return null;
  };

  // Recursive function to walk the AST
  const walkNode = (node: any): void => {
    if (!node || typeof node !== 'object') return;

    // Check for call expressions that might be test functions
    if (node.type === 'CallExpression') {
      let functionName: string | null = null;

      // Handle direct function calls: test(), it(), describe()
      if (node.callee?.type === 'Identifier') {
        functionName = node.callee.value;
      }
      // Handle member expressions: test.only(), describe.skip()
      else if (
        node.callee?.type === 'MemberExpression' &&
        node.callee.object?.type === 'Identifier'
      ) {
        functionName = node.callee.object.value;
      }

      if (functionName && testFunctions.has(functionName)) {
        // Extract test name from first argument
        const firstArg = node.arguments?.[0];
        const testName = getStringLiteralValue(firstArg.expression);
        const range = spanToRange(node.span);

        events.onTest(range, testName || 'unnamed test', functionName as any);
      }
    }

    // More comprehensive recursive traversal
    const visitValue = (value: any): void => {
      if (Array.isArray(value)) {
        value.forEach(visitValue);
      } else if (value && typeof value === 'object') {
        walkNode(value);
      }
    };

    // Walk through all properties of the node
    Object.keys(node).forEach((key) => {
      // Skip certain properties that don't contain AST nodes
      if (
        key === 'span' ||
        key === 'type' ||
        key === 'value' ||
        key === 'raw'
      ) {
        return;
      }
      visitValue(node[key]);
    });
  };

  // Start walking from the root
  walkNode(ast);
};
