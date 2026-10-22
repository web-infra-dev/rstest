import { readFile } from 'node:fs/promises';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import type { CallExpression } from '@babel/types';
import type {
  InternalProjectContext,
  SerializedError,
  TestInfo,
} from '../../types';
import { toSerializedError } from '../../utils/error';

export interface TypeTestFile {
  testPath: string;
  project: string;
  tests: TestInfo[];
  ranges: { start: number; end: number; test: TestInfo }[];
  errors: SerializedError[];
  source: string;
}

export async function collectTypeTests(
  testPath: string,
  project: InternalProjectContext,
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
  try {
    const ast = parse(source, {
      sourceType: 'unambiguous',
      plugins: [
        'typescript',
        ...(testPath.endsWith('x') ? ['jsx' as const] : []),
      ],
    });
    const registrations = new Map<CallExpression, TestInfo>();
    traverse(ast, {
      CallExpression(path) {
        let callee = path.node.callee;
        const modifiers: string[] = [];
        while (callee.type === 'MemberExpression') {
          const member =
            !callee.computed && callee.property.type === 'Identifier'
              ? callee.property.name
              : callee.property.type === 'StringLiteral'
                ? callee.property.value
                : '<computed>';
          modifiers.unshift(member);
          callee = callee.object;
        }
        if (callee.type !== 'Identifier') return;
        const binding = path.scope.getBinding(callee.name);
        let apiName = callee.name;
        if (binding) {
          if (
            !binding.path.parentPath?.isImportDeclaration() ||
            binding.path.parentPath.node.source.value !== '@rstest/core'
          )
            return;
          if (binding.path.isImportSpecifier()) {
            const imported = binding.path.node.imported;
            apiName =
              imported.type === 'Identifier' ? imported.name : imported.value;
          } else if (binding.path.isImportNamespaceSpecifier()) {
            apiName = modifiers.shift() ?? '';
          } else return;
        } else if (!project.normalizedConfig.globals) return;
        if (!['test', 'it', 'describe'].includes(apiName)) return;
        // Fixture declarations remain valid compiler input, but do not register static cases.
        if (modifiers[0] === 'extend') return;
        if (modifiers.length) {
          file.errors.push({
            message: `Type tests do not support ${apiName}.${modifiers.join('.')}. Use plain describe, test or it.`,
            stack: `at ${testPath}:${path.node.loc?.start.line}:1`,
          });
          path.skip();
          return;
        }
        const ancestors = path.getAncestry().slice(1);
        const parentCall = ancestors.find(
          (ancestor) =>
            ancestor.isCallExpression() && registrations.has(ancestor.node),
        );
        const parent = parentCall?.isCallExpression()
          ? registrations.get(parentCall.node)
          : undefined;
        const statement = path.parentPath;
        const container = statement.parentPath;
        const direct =
          statement.isExpressionStatement() &&
          (container?.isProgram() ||
            (container?.isBlockStatement() &&
              parent?.type === 'suite' &&
              container.parentPath.parentPath === parentCall));
        if (!direct) {
          file.errors.push({
            message:
              'Type tests require direct top-level registrations or registrations inside a describe callback; dynamic registration is not supported.',
            stack: `at ${testPath}:${path.node.loc?.start.line}:1`,
          });
          path.skip();
          return;
        }
        if (
          !path.node.arguments.some(
            (argument) =>
              argument.type === 'ArrowFunctionExpression' ||
              argument.type === 'FunctionExpression',
          )
        ) {
          file.errors.push({
            message: 'Type tests require an inline callback.',
            stack: `at ${testPath}:${path.node.loc?.start.line}:1`,
          });
          path.skip();
          return;
        }
        const title = path.node.arguments[0];
        if (!title) return;
        const name =
          title.type === 'StringLiteral'
            ? title.value
            : title.type === 'TemplateLiteral' && title.expressions.length === 0
              ? (title.quasis[0]!.value.cooked ?? '')
              : source.slice(title.start!, title.end!);
        const parentNames = parent
          ? [...(parent.parentNames ?? []), parent.name]
          : [];
        const common = {
          testId: `${project.name}:${testPath}:${path.node.start}`,
          testPath,
          project: project.name,
          name,
          parentNames,
          runMode: 'run' as const,
          meta: { typecheck: true },
          ...(project.normalizedConfig.includeTaskLocation && path.node.loc
            ? {
                location: {
                  line: path.node.loc.start.line,
                  column: path.node.loc.start.column + 1,
                },
              }
            : {}),
        };
        const test: TestInfo =
          apiName === 'describe'
            ? { ...common, type: 'suite', tests: [] }
            : { ...common, type: 'case' };
        registrations.set(path.node, test);
        (parent?.type === 'suite' ? parent.tests : file.tests).push(test);
        file.ranges.push({
          start: path.node.start!,
          end: path.node.end!,
          test,
        });
      },
    });
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
