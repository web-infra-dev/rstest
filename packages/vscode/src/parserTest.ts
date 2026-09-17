import { type Lang, parseSync, type SourceType } from '@swc-next/parser';

type Node = {
  type: string;
  start: number;
  end: number;
  name?: string;
  value?: unknown;
  callee?: Node;
  object?: Node;
  arguments?: Node[];
  quasis?: { value: { cooked?: string; raw: string } }[];
  expressions?: Node[];
  [key: string]: unknown;
};

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
  const result = parseSync(code, {
    // SWC Next declares these runtime strings as ambient const enums, which
    // cannot be referenced when isolatedModules is enabled.
    lang: 'tsx' as Lang,
    preserveParens: false,
    sourceType: 'module' as SourceType,
  });
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
    if (!node.quasis || !node.expressions) {
      return null;
    }
    const expressions = node.expressions;

    return node.quasis
      .map((quasi, index) => {
        const expression = index < expressions.length ? '${...}' : '';
        return `${quasi.value.cooked ?? quasi.value.raw}${expression}`;
      })
      .join('');
  };

  const walkNode = (node: Node): void => {
    let exit: (() => void) | void | undefined;

    if (node.type === 'CallExpression') {
      let functionName: string | undefined;

      if (node.callee?.type === 'Identifier') {
        functionName = node.callee.name;
      } else if (
        node.callee?.type === 'MemberExpression' &&
        node.callee.object?.type === 'Identifier'
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
          getStringLiteralValue(node.arguments?.[0]) || 'unnamed test',
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
