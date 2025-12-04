import { Compiler } from '@swc/core';

export class Range {
  constructor(
    public startLine: number,
    public endLine: number,
    public startChar: number,
    public endChar: number,
  ) {}
}

// Minimal AST typings and type guards to avoid using `any`.
type Span = { start: number; end: number };
type NodeBase = { type: string; span?: Span };

type Identifier = NodeBase & { type: 'Identifier'; value: string };
type MemberExpression = NodeBase & {
  type: 'MemberExpression';
  object: unknown;
};
type Argument = { expression: unknown };
type CallExpression = NodeBase & {
  type: 'CallExpression';
  callee: unknown;
  arguments: Argument[];
  span: Span;
};

type StringLiteral = NodeBase & { type: 'StringLiteral'; value: string };
type TemplateElement = { cooked?: string; raw?: string };
type TemplateLiteral = NodeBase & {
  type: 'TemplateLiteral';
  quasis: TemplateElement[];
  expressions: unknown[];
};

type Program = { span: Span } & { [key: string]: unknown };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

const isSpan = (x: unknown): x is Span =>
  isObject(x) &&
  typeof (x as Record<string, unknown>).start === 'number' &&
  typeof (x as Record<string, unknown>).end === 'number';

const hasSpan = (v: unknown): v is { span: Span } =>
  isObject(v) && isSpan((v as Record<string, unknown>).span);

const isNode = (v: unknown): v is NodeBase =>
  isObject(v) && typeof (v as Record<string, unknown>).type === 'string';
const isIdentifier = (v: unknown): v is Identifier =>
  isNode(v) &&
  (v as Record<string, unknown>).type === 'Identifier' &&
  typeof (v as Record<string, unknown>).value === 'string';
const isMemberExpression = (v: unknown): v is MemberExpression =>
  isNode(v) &&
  (v as Record<string, unknown>).type === 'MemberExpression' &&
  'object' in (v as Record<string, unknown>);
const isCallExpression = (v: unknown): v is CallExpression =>
  isNode(v) &&
  (v as Record<string, unknown>).type === 'CallExpression' &&
  Array.isArray((v as Record<string, unknown>).arguments as unknown[]) &&
  hasSpan(v);
const isArgument = (v: unknown): v is Argument =>
  isObject(v) && 'expression' in v;
const isStringLiteral = (v: unknown): v is StringLiteral =>
  isNode(v) &&
  (v as Record<string, unknown>).type === 'StringLiteral' &&
  typeof (v as Record<string, unknown>).value === 'string';
const isTemplateLiteral = (v: unknown): v is TemplateLiteral =>
  isNode(v) &&
  (v as Record<string, unknown>).type === 'TemplateLiteral' &&
  Array.isArray((v as Record<string, unknown>).quasis as unknown[]) &&
  Array.isArray((v as Record<string, unknown>).expressions as unknown[]);

export const parseTestFile = (
  code: string,
  events: {
    onTest(
      range: Range,
      name: string,
      testType: 'test' | 'it' | 'describe' | 'suite',
    ): void;
  },
) => {
  const compiler = new Compiler();

  // Parse the code using SWC
  const astUnknown = compiler.parseSync(code, {
    syntax: 'typescript',
    tsx: true,
  });

  if (!hasSpan(astUnknown)) {
    // If for some reason the parser returns a program without span, abort early.
    return;
  }

  const ast: Program = astUnknown as unknown as Program;
  const offset = ast.span.start - 1;
  const codebBuffer = Buffer.from(code, 'utf8');

  // Helper function to convert SWC span to VS Code range
  const spanToRange = (span: { start: number; end: number }): Range => {
    const startSlice = codebBuffer.subarray(0, span.start - offset);
    const startCharIndex = startSlice.toString('utf8').length;

    const endSlice = codebBuffer.subarray(0, span.end - offset);
    const endCharIndex = endSlice.toString('utf8').length;

    const lines = code.substring(0, startCharIndex).split('\n');
    const startLine = Math.max(0, lines.length - 1);
    const startChar = lines[startLine]?.length || 0;

    const endLines = code.substring(0, endCharIndex).split('\n');
    const endLine = Math.max(0, endLines.length - 1);
    const endChar = endLines[endLine]?.length || 0;

    return new Range(startLine, endLine, startChar, endChar);
  };

  // Common test function names to detect
  const testFunctions = new Set(['test', 'it', 'describe', 'suite']);

  // Helper function to extract string literal value
  const getStringLiteralValue = (node: unknown): string | null => {
    if (!node) return null;

    if (isStringLiteral(node)) {
      return node.value;
    }
    if (isTemplateLiteral(node)) {
      // For simple template literals without expressions
      if (node.quasis?.length === 1 && node.expressions.length === 0) {
        return node.quasis[0].cooked || node.quasis[0].raw || '';
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
  const walkNode = (node: unknown): void => {
    if (!isObject(node)) {
      return;
    }

    // Check for call expressions that might be test functions
    if (isCallExpression(node)) {
      let functionName: string | null = null;

      // Handle direct function calls: test(), it(), describe()
      const callee = (node as CallExpression).callee;
      if (isIdentifier(callee)) {
        functionName = callee.value;
      }
      // Handle member expressions: test.only(), describe.skip()
      else if (isMemberExpression(callee)) {
        const obj = callee.object;
        if (isIdentifier(obj)) {
          functionName = obj.value;
        }
      }

      if (functionName && testFunctions.has(functionName)) {
        // Extract test name from first argument
        const firstArg = node.arguments?.[0] || undefined;
        const expr =
          firstArg && isArgument(firstArg) ? firstArg.expression : undefined;
        const testName = getStringLiteralValue(expr);
        const range = spanToRange(node.span);

        type TestFn = 'test' | 'it' | 'describe' | 'suite';
        events.onTest(
          range,
          testName || 'unnamed test',
          functionName as TestFn,
        );
      }
    }

    // Walk through all properties of the node to find nested structures
    for (const key in node) {
      if (key === 'span') {
        continue;
      }

      const value = (node as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          // Recurse into array elements to discover nested structures,
          // even if they are wrapper objects (e.g., CallExpression arguments).
          walkNode(child as unknown);
        }
      } else if (isNode(value)) {
        walkNode(value);
      }
    }
  };

  // Start walking from the root
  walkNode(ast);
};
