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
    bindings: Map<string, NameBinding[]>;
  };
  type NameValue =
    | { type: 'name'; value: string }
    | { type: 'alias'; name: string; scope: NameScope; position: number }
    | null;
  type NameBinding = {
    kind: 'function' | 'import' | 'lexical' | 'parameter' | 'variable';
    position: number;
    initialized: boolean;
    value: NameValue;
  };

  const scopesByNode = new WeakMap<Node, NameScope>();
  const createScope = (
    parent: NameScope | null,
    isFunctionScope = false,
  ): NameScope => ({ parent, isFunctionScope, bindings: new Map() });

  const addBinding = (
    name: string,
    scope: NameScope,
    binding: NameBinding,
  ): void => {
    const bindings = scope.bindings.get(name) ?? [];
    bindings.push(binding);
    scope.bindings.set(name, bindings);
  };

  const addPatternBindings = (
    pattern: Node,
    scope: NameScope,
    binding: NameBinding,
  ): void => {
    if (pattern.type === 'Identifier') {
      addBinding(pattern.name, scope, binding);
    } else if (pattern.type === 'RestElement') {
      if (isNode(pattern.argument)) {
        addPatternBindings(pattern.argument, scope, {
          ...binding,
          value: null,
        });
      }
    } else if (pattern.type === 'AssignmentPattern') {
      if (isNode(pattern.left)) {
        addPatternBindings(pattern.left, scope, { ...binding, value: null });
      }
    } else if (pattern.type === 'ArrayPattern') {
      for (const element of pattern.elements) {
        if (isNode(element)) {
          addPatternBindings(element, scope, { ...binding, value: null });
        }
      }
    } else if (pattern.type === 'ObjectPattern') {
      for (const property of pattern.properties) {
        if (!isNode(property)) {
          continue;
        }
        const nestedPattern =
          property.type === 'RestElement' ? property.argument : property.value;
        if (isNode(nestedPattern)) {
          addPatternBindings(nestedPattern, scope, {
            ...binding,
            value: null,
          });
        }
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
      const kind = node.type === 'FunctionDeclaration' ? 'function' : 'lexical';
      const binding: NameBinding = {
        kind,
        position: node.type === 'FunctionDeclaration' ? node.start : node.end,
        initialized: true,
        value: { type: 'name', value: node.id.name },
      };
      addBinding(node.id.name, parentScope, binding);
      addBinding(node.id.name, scope, binding);
    } else if (
      (node.type === 'FunctionExpression' || node.type === 'ClassExpression') &&
      isNode(node.id) &&
      node.id.type === 'Identifier'
    ) {
      addBinding(node.id.name, scope, {
        kind: 'lexical',
        position: node.start,
        initialized: true,
        value: { type: 'name', value: node.id.name },
      });
    }

    if (node.type === 'VariableDeclaration') {
      const declarationScope =
        node.kind === 'var' ? findFunctionScope(scope) : scope;
      for (const declaration of node.declarations) {
        if (!isNode(declaration) || !isNode(declaration.id)) {
          continue;
        }

        const initializer = isNode(declaration.init)
          ? declaration.init
          : undefined;
        let value: NameValue = null;
        if (initializer?.type === 'Identifier') {
          value = {
            type: 'alias',
            name: initializer.name,
            scope: declarationScope,
            position: initializer.start,
          };
        } else if (
          declaration.id.type === 'Identifier' &&
          (initializer?.type === 'ArrowFunctionExpression' ||
            initializer?.type === 'FunctionExpression' ||
            initializer?.type === 'ClassExpression')
        ) {
          const name =
            (initializer.type !== 'ArrowFunctionExpression' &&
            isNode(initializer.id) &&
            initializer.id.type === 'Identifier'
              ? initializer.id.name
              : undefined) ?? declaration.id.name;
          value = { type: 'name', value: name };
        }

        addPatternBindings(declaration.id, declarationScope, {
          kind: node.kind === 'var' ? 'variable' : 'lexical',
          position: initializer?.end ?? declaration.start,
          initialized: Boolean(initializer),
          value,
        });
      }
    } else if (
      (node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression') &&
      Array.isArray(node.params)
    ) {
      for (const param of node.params) {
        if (isNode(param)) {
          addPatternBindings(param, scope, {
            kind: 'parameter',
            position: node.start,
            initialized: true,
            value: null,
          });
        }
      }
    } else if (node.type === 'CatchClause' && isNode(node.param)) {
      addPatternBindings(node.param, scope, {
        kind: 'parameter',
        position: node.start,
        initialized: true,
        value: null,
      });
    } else if (
      node.type === 'ImportDeclaration' &&
      Array.isArray(node.specifiers)
    ) {
      for (const specifier of node.specifiers) {
        if (!isNode(specifier) || !isNode(specifier.local)) {
          continue;
        }

        const name =
          node.importKind !== 'type' &&
          specifier.type === 'ImportSpecifier' &&
          specifier.importKind !== 'type' &&
          isNode(specifier.imported) &&
          specifier.imported.type === 'Identifier'
            ? specifier.imported.name
            : null;
        addPatternBindings(specifier.local, scope, {
          kind: 'import',
          position: node.start,
          initialized: true,
          value: name === null ? null : { type: 'name', value: name },
        });
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

  collectNameScopes(result.program, createScope(null, true));

  const resolveName = (
    name: string,
    scope: NameScope | undefined,
    position: number,
    seen: Set<NameBinding>,
  ): string | null => {
    let current = scope;
    while (current) {
      const bindings = current.bindings.get(name);
      if (bindings?.length) {
        const initialized = bindings.filter(
          (binding) => binding.initialized && binding.position <= position,
        );
        const variable = initialized
          .filter((binding) => binding.kind === 'variable')
          .sort((a, b) => b.position - a.position)[0];
        const lexical = initialized
          .filter((binding) => binding.kind === 'lexical')
          .sort((a, b) => b.position - a.position)[0];
        const imported = initialized.find(
          (binding) => binding.kind === 'import',
        );
        const functionDeclaration = bindings
          .filter((binding) => binding.kind === 'function')
          .sort((a, b) => b.position - a.position)[0];
        const binding = variable ?? lexical ?? imported ?? functionDeclaration;

        if (!binding || !binding.value || seen.has(binding)) {
          return null;
        }
        if (binding.value.type === 'name') {
          return binding.value.value;
        }

        seen.add(binding);
        return resolveName(
          binding.value.name,
          binding.value.scope,
          binding.value.position,
          seen,
        );
      }
      current = current.parent ?? undefined;
    }
    return null;
  };

  const getFunctionName = (
    node: Node | undefined,
    scope: NameScope | undefined,
    position: number,
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
    return resolveName(node.name, scope, position, new Set());
  };

  const walkNode = (node: Node): void => {
    let exit: (() => void) | void | undefined;
    let functionTitleNode: Node | undefined;

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
        const title = node.arguments[0];
        if (
          isNode(title) &&
          (title.type === 'FunctionExpression' ||
            title.type === 'ClassExpression' ||
            title.type === 'ArrowFunctionExpression')
        ) {
          functionTitleNode = title;
        }
        exit = events.onTest(
          offsetToRange(node.start, node.end),
          getStringLiteralValue(node.arguments[0]) ||
            getFunctionName(
              node.arguments[0],
              scopesByNode.get(node),
              node.start,
            ) ||
            'unnamed test',
          functionName,
        );
      }
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) {
          if (isNode(child) && child !== functionTitleNode) {
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
