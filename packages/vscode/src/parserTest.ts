import { type Node, parse } from 'yuku-parser';

export class Range {
  constructor(
    public startLine: number,
    public endLine: number,
    public startChar: number,
    public endChar: number,
  ) {}
}

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  typeof value.type === 'string';

export const parseTestFile = (
  code: string,
  events: {
    onTest(
      range: Range,
      name: string,
      testType: 'test' | 'it' | 'describe' | 'suite',
    ): (() => void) | void;
  },
) => {
  const result = parse(code, {
    lang: 'tsx',
    preserveParens: false,
    sourceType: 'module',
  });
  const error = result.diagnostics.find(
    (diagnostic) => diagnostic.severity === 'error',
  );
  if (error) {
    throw new SyntaxError(error.message);
  }

  const offsetToRange = (start: number, end: number): Range => {
    const lines = code.substring(0, start).split('\n');
    const startLine = Math.max(0, lines.length - 1);
    const startChar = lines[startLine]?.length || 0;

    const endLines = code.substring(0, end).split('\n');
    const endLine = Math.max(0, endLines.length - 1);
    const endChar = endLines[endLine]?.length || 0;

    return new Range(startLine, endLine, startChar, endChar);
  };

  const getStringLiteralValue = (node: Node | undefined): string | null => {
    if (node?.type === 'Literal' && typeof node.value === 'string') {
      return node.value;
    }
    if (node?.type !== 'TemplateLiteral') {
      return null;
    }

    return node.quasis
      .map((quasi, index) => {
        const expression = index < node.expressions.length ? '${...}' : '';
        return `${quasi.value.cooked ?? quasi.value.raw}${expression}`;
      })
      .join('');
  };

  const functionNames = new Map<string, string>();
  const collectFunctionNames = (node: Node): void => {
    if (
      (node.type === 'FunctionDeclaration' ||
        node.type === 'ClassDeclaration') &&
      isNode(node.id) &&
      node.id.type === 'Identifier'
    ) {
      functionNames.set(node.id.name, node.id.name);
    } else if (
      node.type === 'VariableDeclarator' &&
      isNode(node.id) &&
      node.id.type === 'Identifier' &&
      isNode(node.init) &&
      (node.init.type === 'ArrowFunctionExpression' ||
        node.init.type === 'FunctionExpression' ||
        node.init.type === 'ClassExpression')
    ) {
      const name =
        isNode(node.init.id) && node.init.id.type === 'Identifier'
          ? node.init.id.name
          : node.id.name;
      functionNames.set(node.id.name, name);
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) {
          if (isNode(child)) {
            collectFunctionNames(child);
          }
        }
      } else if (isNode(value)) {
        collectFunctionNames(value);
      }
    }
  };

  collectFunctionNames(result.program);

  const getFunctionName = (node: Node | undefined): string | null =>
    node?.type === 'Identifier' ? (functionNames.get(node.name) ?? null) : null;

  const walkNode = (node: Node): void => {
    let exit: (() => void) | void | undefined;

    if (node.type === 'CallExpression') {
      let functionName: string | undefined;

      if (node.callee.type === 'Identifier') {
        functionName = node.callee.name;
      } else if (
        node.callee.type === 'MemberExpression' &&
        node.callee.object.type === 'Identifier'
      ) {
        functionName = node.callee.object.name;
      }

      if (
        functionName === 'test' ||
        functionName === 'it' ||
        functionName === 'describe' ||
        functionName === 'suite'
      ) {
        exit = events.onTest(
          offsetToRange(node.start, node.end),
          getStringLiteralValue(node.arguments[0]) ||
            getFunctionName(node.arguments[0]) ||
            'unnamed test',
          functionName,
        );
      }
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) {
          if (isNode(child)) {
            walkNode(child);
          }
        }
      } else if (isNode(value)) {
        walkNode(value);
      }
    }

    exit?.();
  };

  walkNode(result.program);
};
