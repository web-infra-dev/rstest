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

  type NameScope = {
    parent: NameScope | null;
    isFunctionScope: boolean;
    bindings: Map<string, string | null>;
  };

  const scopesByNode = new WeakMap<Node, NameScope>();
  const createScope = (
    parent: NameScope | null,
    isFunctionScope = false,
  ): NameScope => ({ parent, isFunctionScope, bindings: new Map() });

  const addPatternBindings = (
    pattern: Node,
    scope: NameScope,
    name: string | null,
  ): void => {
    if (pattern.type === 'Identifier') {
      scope.bindings.set(pattern.name, name);
    } else if (pattern.type === 'RestElement') {
      if (isNode(pattern.argument)) {
        addPatternBindings(pattern.argument, scope, null);
      }
    } else if (pattern.type === 'AssignmentPattern') {
      if (isNode(pattern.left)) {
        addPatternBindings(pattern.left, scope, null);
      }
    } else if (pattern.type === 'ArrayPattern') {
      for (const element of pattern.elements) {
        if (isNode(element)) {
          addPatternBindings(element, scope, null);
        }
      }
    } else if (pattern.type === 'ObjectPattern') {
      for (const property of pattern.properties) {
        if (!isNode(property)) {
          continue;
        }
        const binding =
          property.type === 'RestElement' ? property.argument : property.value;
        if (isNode(binding)) {
          addPatternBindings(binding, scope, null);
        }
      }
    }
  };

  const functionNameFromInitializer = (
    initializer: Node | undefined,
    inferredName: string,
  ): string | null => {
    if (!initializer) {
      return null;
    }
    if (initializer.type === 'ArrowFunctionExpression') {
      return inferredName;
    }
    if (
      initializer.type === 'FunctionExpression' ||
      initializer.type === 'ClassExpression'
    ) {
      return isNode(initializer.id) && initializer.id.type === 'Identifier'
        ? initializer.id.name
        : inferredName;
    }
    return null;
  };

  const collectNameScopes = (node: Node, parentScope: NameScope): void => {
    const createsFunctionScope =
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression';
    const createsBlockScope =
      node.type === 'BlockStatement' ||
      node.type === 'ClassDeclaration' ||
      node.type === 'ClassExpression' ||
      node.type === 'ForStatement' ||
      node.type === 'ForInStatement' ||
      node.type === 'ForOfStatement' ||
      node.type === 'SwitchStatement' ||
      node.type === 'CatchClause';
    const scope =
      createsFunctionScope || createsBlockScope
        ? createScope(parentScope, createsFunctionScope)
        : parentScope;

    if (
      (node.type === 'FunctionDeclaration' ||
        node.type === 'ClassDeclaration') &&
      isNode(node.id) &&
      node.id.type === 'Identifier'
    ) {
      parentScope.bindings.set(node.id.name, node.id.name);
      scope.bindings.set(node.id.name, node.id.name);
    } else if (
      (node.type === 'FunctionExpression' || node.type === 'ClassExpression') &&
      isNode(node.id) &&
      node.id.type === 'Identifier'
    ) {
      scope.bindings.set(node.id.name, node.id.name);
    }

    if (node.type === 'VariableDeclaration') {
      const declarationScope =
        node.kind === 'var' ? findFunctionScope(scope) : scope;
      for (const declaration of node.declarations) {
        if (isNode(declaration) && isNode(declaration.id)) {
          const name =
            declaration.id.type === 'Identifier'
              ? functionNameFromInitializer(
                  isNode(declaration.init) ? declaration.init : undefined,
                  declaration.id.name,
                )
              : null;
          addPatternBindings(declaration.id, declarationScope, name ?? null);
        }
      }
    } else if (
      (node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression') &&
      Array.isArray(node.params)
    ) {
      for (const param of node.params) {
        if (isNode(param)) {
          addPatternBindings(param, scope, null);
        }
      }
    } else if (node.type === 'CatchClause' && isNode(node.param)) {
      addPatternBindings(node.param, scope, null);
    } else if (
      node.type === 'ImportDeclaration' &&
      Array.isArray(node.specifiers)
    ) {
      for (const specifier of node.specifiers) {
        if (isNode(specifier) && isNode(specifier.local)) {
          const name =
            specifier.type === 'ImportSpecifier' &&
            isNode(specifier.imported) &&
            specifier.imported.type === 'Identifier'
              ? specifier.imported.name
              : null;
          addPatternBindings(specifier.local, scope, name);
        }
      }
    }

    scopesByNode.set(node, scope);

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) {
          if (isNode(child)) {
            collectNameScopes(child, scope);
          }
        }
      } else if (isNode(value)) {
        collectNameScopes(value, scope);
      }
    }
  };

  const findFunctionScope = (scope: NameScope): NameScope => {
    let current = scope;
    while (!current.isFunctionScope && current.parent) {
      current = current.parent;
    }
    return current;
  };

  collectNameScopes(result.program, createScope(null, true));

  const getFunctionName = (
    node: Node | undefined,
    scope: NameScope | undefined,
  ): string | null => {
    if (
      node?.type === 'FunctionExpression' ||
      node?.type === 'ClassExpression'
    ) {
      return isNode(node.id) && node.id.type === 'Identifier'
        ? node.id.name
        : '<anonymous>';
    }
    if (node?.type === 'ArrowFunctionExpression') {
      return '<anonymous>';
    }
    if (node?.type !== 'Identifier') {
      return null;
    }

    let current = scope;
    while (current) {
      if (current.bindings.has(node.name)) {
        return current.bindings.get(node.name) ?? null;
      }
      current = current.parent ?? undefined;
    }
    return null;
  };

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
            getFunctionName(node.arguments[0], scopesByNode.get(node)) ||
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
