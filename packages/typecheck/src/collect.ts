import { readFile } from 'node:fs/promises';
import { parse, type CallExpression, type Node } from 'yuku-parser';
import { bindingIdentifiers, nameOf, walk } from 'yuku-ast';
import { toSerializedError } from '@rstest/core/internal/typecheck';
import type {
  InternalProjectContext,
  SerializedError,
  TestInfo,
} from '@rstest/core/internal/typecheck';

export interface TypeTestFile {
  testPath: string;
  project: string;
  tests: TestInfo[];
  ranges: { start: number; end: number; test: TestInfo }[];
  errors: SerializedError[];
  source: string;
}

interface Scope {
  parent?: Scope;
  functionScope: boolean;
  bindings: Map<string, string | null>;
}

export async function collectTypeTests(
  testPath: string,
  project: Pick<InternalProjectContext, 'name'> & {
    normalizedConfig: Pick<
      InternalProjectContext['normalizedConfig'],
      'globals' | 'includeTaskLocation'
    >;
  },
): Promise<TypeTestFile> {
  const source = await readFile(testPath, 'utf8');
  const file: TypeTestFile = {
    testPath,
    project: project.name,
    source,
    tests: [],
    ranges: [],
    errors: [],
  };
  const lineStarts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source.charCodeAt(index) === 10) lineStarts.push(index + 1);
  }
  const locationAt = (offset: number) => {
    let low = 0;
    let high = lineStarts.length;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (lineStarts[middle]! <= offset) low = middle;
      else high = middle;
    }
    return { line: low + 1, column: offset - lineStarts[low]! + 1 };
  };
  const errorAt = (message: string, offset: number) => {
    const { line, column } = locationAt(offset);
    file.errors.push({ message, stack: `at ${testPath}:${line}:${column}` });
  };
  try {
    const { program, diagnostics } = parse(source, {
      lang: testPath.endsWith('x') ? 'tsx' : 'ts',
      sourceType: 'module',
      preserveParens: false,
    });
    for (const diagnostic of diagnostics) {
      if (diagnostic.severity === 'error')
        errorAt(diagnostic.message, diagnostic.start);
    }
    if (file.errors.length) return file;
    const registrationNames = new Set(
      project.normalizedConfig.globals ? ['test', 'it', 'describe'] : [],
    );
    for (const statement of program.body) {
      if (
        statement.type !== 'ImportDeclaration' ||
        !['@rstest/core', '@rstest/typecheck'].includes(statement.source.value)
      )
        continue;
      for (const specifier of statement.specifiers) {
        if (
          specifier.type === 'ImportNamespaceSpecifier' ||
          (specifier.type === 'ImportSpecifier' &&
            ['test', 'it', 'describe'].includes(nameOf(specifier.imported)))
        )
          registrationNames.add(specifier.local.name);
      }
    }
    let scope: Scope = { functionScope: true, bindings: new Map() };
    const candidates: {
      node: CallExpression;
      scope: Scope;
      name: string;
      modifiers: string[];
      container?: Node;
    }[] = [];
    const scopedNodes = new Set<Node>();
    walk(program, {
      enter(node) {
        if (
          (node.type === 'FunctionDeclaration' ||
            node.type === 'ClassDeclaration' ||
            node.type === 'TSDeclareFunction') &&
          node.id
        )
          scope.bindings.set(node.id.name, null);
        if (
          node.type === 'TSEnumDeclaration' ||
          node.type === 'TSImportEqualsDeclaration'
        )
          scope.bindings.set(node.id.name, null);
        if (
          node.type === 'TSModuleDeclaration' &&
          node.id.type === 'Identifier'
        )
          scope.bindings.set(node.id.name, null);
        const isFunction =
          node.type === 'FunctionDeclaration' ||
          node.type === 'FunctionExpression' ||
          node.type === 'ArrowFunctionExpression' ||
          node.type === 'TSDeclareFunction';
        if (
          isFunction ||
          node.type === 'BlockStatement' ||
          node.type === 'CatchClause' ||
          node.type === 'ForStatement' ||
          node.type === 'ForInStatement' ||
          node.type === 'ForOfStatement' ||
          node.type === 'SwitchStatement' ||
          node.type === 'ClassExpression' ||
          node.type === 'ClassDeclaration' ||
          node.type === 'StaticBlock' ||
          node.type === 'TSModuleBlock'
        ) {
          scope = {
            parent: scope,
            functionScope:
              isFunction ||
              node.type === 'StaticBlock' ||
              node.type === 'TSModuleBlock',
            bindings: new Map(),
          };
          scopedNodes.add(node);
        }
        if (isFunction) {
          if ('id' in node && node.id) scope.bindings.set(node.id.name, null);
          for (const parameter of node.params) {
            const pattern =
              parameter.type === 'TSParameterProperty'
                ? parameter.parameter
                : parameter.type === 'RestElement'
                  ? parameter.argument
                  : parameter;
            if (
              pattern.type === 'Identifier' ||
              pattern.type === 'ArrayPattern' ||
              pattern.type === 'ObjectPattern' ||
              pattern.type === 'AssignmentPattern'
            ) {
              for (const id of bindingIdentifiers(pattern))
                scope.bindings.set(id.name, null);
            }
          }
        }
        if (
          (node.type === 'ClassExpression' ||
            node.type === 'ClassDeclaration') &&
          node.id
        )
          scope.bindings.set(node.id.name, null);
        if (node.type === 'CatchClause') {
          for (const id of bindingIdentifiers(node.param))
            scope.bindings.set(id.name, null);
        }
      },
      leave(node) {
        if (scopedNodes.has(node)) scope = scope.parent!;
      },
      ImportDeclaration(node) {
        const supported =
          node.source.value === '@rstest/core' ||
          node.source.value === '@rstest/typecheck';
        for (const specifier of node.specifiers) {
          const imported =
            supported && node.importKind !== 'type'
              ? specifier.type === 'ImportSpecifier' &&
                specifier.importKind !== 'type'
                ? nameOf(specifier.imported)
                : specifier.type === 'ImportNamespaceSpecifier'
                  ? '*'
                  : null
              : null;
          scope.bindings.set(specifier.local.name, imported);
        }
      },
      VariableDeclaration(node) {
        let target = scope;
        if (node.kind === 'var') {
          while (!target.functionScope && target.parent) target = target.parent;
        }
        for (const declaration of node.declarations) {
          for (const id of bindingIdentifiers(declaration.id))
            target.bindings.set(id.name, null);
        }
      },
      CallExpression(node, context) {
        let callee = node.callee;
        const modifiers: string[] = [];
        while (callee.type === 'MemberExpression') {
          modifiers.unshift(
            !callee.computed && callee.property.type === 'Identifier'
              ? callee.property.name
              : callee.property.type === 'Literal' &&
                  typeof callee.property.value === 'string'
                ? callee.property.value
                : '<computed>',
          );
          callee = callee.object;
        }
        if (callee.type !== 'Identifier' || !registrationNames.has(callee.name))
          return;
        const ancestors = context.ancestors();
        candidates.push({
          node,
          scope,
          name: callee.name,
          modifiers,
          container:
            context.parent?.type === 'ExpressionStatement'
              ? ancestors[ancestors.length - 2]
              : undefined,
        });
      },
    });
    const suites = new Map<Node, TestInfo>();
    let rejectedEnd = -1;
    // Resolve after walking so declarations shadow imports/globals throughout their scope, including before the declaration.
    for (const { node, scope, name, modifiers, container } of candidates) {
      if (node.start < rejectedEnd) continue;
      let binding: string | null | undefined;
      for (
        let current: Scope | undefined = scope;
        current;
        current = current.parent
      ) {
        if (current.bindings.has(name)) {
          binding = current.bindings.get(name);
          break;
        }
      }
      const apiName =
        binding === '*'
          ? modifiers.shift()
          : binding === undefined && project.normalizedConfig.globals
            ? name
            : binding;
      if (apiName !== 'test' && apiName !== 'it' && apiName !== 'describe')
        continue;
      if (modifiers[0] === 'extend') continue;
      let error: string | undefined;
      const parent = container ? suites.get(container) : undefined;
      const callback = node.arguments.find(
        (argument) =>
          argument.type === 'ArrowFunctionExpression' ||
          argument.type === 'FunctionExpression',
      );
      if (modifiers.length)
        error = `Type tests do not support ${apiName}.${modifiers.join('.')}. Use plain describe, test or it.`;
      else if (container?.type !== 'Program' && !parent)
        error =
          'Type tests require direct top-level registrations or registrations inside a describe callback; dynamic registration is not supported.';
      else if (!callback) error = 'Type tests require an inline callback.';
      if (error) {
        errorAt(error, node.start);
        rejectedEnd = node.end;
        continue;
      }
      const title = node.arguments[0];
      if (!title) continue;
      const testName =
        title.type === 'Literal' && typeof title.value === 'string'
          ? title.value
          : title.type === 'TemplateLiteral' && title.expressions.length === 0
            ? (title.quasis[0]!.value.cooked ?? '')
            : source.slice(title.start, title.end);
      const common = {
        testId: `${project.name}:${testPath}:${node.start}`,
        testPath,
        project: project.name,
        name: testName,
        parentNames: parent ? [...(parent.parentNames ?? []), parent.name] : [],
        runMode: 'run' as const,
        meta: { typecheck: true },
        ...(project.normalizedConfig.includeTaskLocation
          ? { location: locationAt(node.start) }
          : {}),
      };
      const test: TestInfo =
        apiName === 'describe'
          ? { ...common, type: 'suite', tests: [] }
          : { ...common, type: 'case' };
      if (test.type === 'suite' && callback?.body)
        suites.set(callback.body, test);
      (parent?.type === 'suite' ? parent.tests : file.tests).push(test);
      file.ranges.push({ start: node.start, end: node.end, test });
    }
  } catch (error) {
    file.errors.push(toSerializedError(error));
  }
  if (!file.tests.length && !file.errors.length) {
    const test: TestInfo = {
      testId: `${project.name}:${testPath}:file`,
      testPath,
      project: project.name,
      name: '[typecheck]',
      type: 'case',
      runMode: 'run',
      meta: { typecheck: true },
    };
    file.tests.push(test);
    file.ranges.push({ start: 0, end: source.length, test });
  }
  return file;
}
