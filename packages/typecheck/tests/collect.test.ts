import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { collectTypeTests } from '../src/collect';
import { parseDiagnostics } from '../src/checker';

it('parses multiline compiler diagnostics, CRLF and paths containing parentheses', () => {
  const { diagnostics, unparsed } = parseDiagnostics(
    'src/a (b).ts(2,3): error TS2344: First line\r\n  Details\r\nerror TS18003: No inputs\r\n',
    '/project',
  );
  expect(unparsed).toEqual([]);
  expect(diagnostics[0]).toMatchObject({
    file: '/project/src/a (b).ts',
    line: 2,
    column: 3,
    error: { name: 'TS2344', message: 'First line\n  Details' },
  });
  expect(diagnostics[1]).toMatchObject({
    file: undefined,
    error: { name: 'TS18003', message: 'No inputs' },
  });
  expect(parseDiagnostics('compiler crashed', '/project').unparsed).toEqual([
    'compiler crashed',
  ]);
});

it('collects aliases, namespace calls and expression names without evaluating them, respecting shadowing', async ({
  onTestFinished,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'rstest-type-collect-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'test.test-d.ts');
  await writeFile(
    path,
    `import { describe, test as check } from '@rstest/core';
import * as rstest from '@rstest/core';
const label = 'dynamic';
describe('suite', () => { check(label, () => {}); });
rstest.test('namespace', () => {});
function helper(check: (name: string, fn: () => void) => void) { check('shadowed', () => {}); }
`,
  );
  const file = await collectTypeTests(path, {
    name: 'types',
    normalizedConfig: { globals: false, includeTaskLocation: true },
  });
  expect(file.errors).toEqual([]);
  expect(file.tests.map((test) => test.name)).toEqual(['suite', 'namespace']);
  expect(file.tests[0]).toMatchObject({
    type: 'suite',
    tests: [{ name: 'label', parentNames: ['suite'], location: { line: 4 } }],
  });
});

it.for([
  "test['skip']('bad', () => {});",
  "test.only('bad', () => {});",
  "describe.skip('bad', () => {});",
  "for (const name of ['a']) test(name, () => {});",
  "test('bad', callback);",
])(
  'rejects unsupported registration: %s',
  async (registration, { onTestFinished }) => {
    const root = await mkdtemp(join(tmpdir(), 'rstest-type-collect-'));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const path = join(root, 'test.test-d.ts');
    await writeFile(
      path,
      `import { test, describe } from '@rstest/core';\n${registration}`,
    );
    expect(
      (
        await collectTypeTests(path, {
          name: 'types',
          normalizedConfig: { globals: false, includeTaskLocation: false },
        })
      ).errors,
    ).toHaveLength(1);
  },
);

it('separates compiler input paths from diagnostics', () => {
  const result = parseDiagnostics(
    'a.ts(1,1): error TS2322: Invalid type\n/project/a.ts\nC:/project/b.ts\n',
    '/project',
  );
  expect(result.files).toEqual(['/project/a.ts', 'C:/project/b.ts']);
  expect(result.diagnostics).toHaveLength(1);
  expect(result.unparsed).toEqual([]);
});

it.for([
  "function helper(check: unknown) { check('parameter', () => {}); }",
  "function helper(...check: unknown[]) { check('rest', () => {}); }",
  "function helper({check}: {check: unknown}) { check('destructured', () => {}); }",
  "{ check('lexical', () => {}); const check = local; }",
  "function helper() { check('hoisted', () => {}); if (true) { var check = local; } }",
  "try {} catch (check) { check('caught', () => {}); }",
  "for (const check of []) { check('loop', () => {}); }",
  "const helper = function check() { check('named function', () => {}); };",
])(
  'ignores shadowed registrations: %s',
  async (shadowed, { onTestFinished }) => {
    const root = await mkdtemp(join(tmpdir(), 'rstest-type-scope-'));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const path = join(root, 'test.test-d.ts');
    await writeFile(
      path,
      `import { test as check } from '@rstest/typecheck';\n${shadowed}\ncheck('real', () => {});`,
    );
    const file = await collectTypeTests(path, {
      name: 'types',
      normalizedConfig: { globals: false, includeTaskLocation: false },
    });
    expect(file.errors).toEqual([]);
    expect(file.tests.map((test) => test.name)).toEqual(['real']);
  },
);

it('keeps UTF-16 locations and nested TSX ranges', async ({
  onTestFinished,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'rstest-type-unicode-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'test.test-d.tsx');
  const source = `import * as types from '@rstest/typecheck';\r\nconst text = '中文😀'; types.describe('套件', () => { types.it(\`名称\`, () => { const view = <div>{text}</div>; }); });`;
  await writeFile(path, source);
  const file = await collectTypeTests(path, {
    name: 'types',
    normalizedConfig: { globals: false, includeTaskLocation: true },
  });
  expect(file.errors).toEqual([]);
  expect(file.tests[0]).toMatchObject({
    name: '套件',
    location: {
      line: 2,
      column: source.split('\r\n')[1]!.indexOf('types.describe') + 1,
    },
    tests: [{ name: '名称', parentNames: ['套件'] }],
  });
  expect(source.slice(file.ranges[1]!.start, file.ranges[1]!.end)).toBe(
    'types.it(`名称`, () => { const view = <div>{text}</div>; })',
  );
});

it('reports syntax errors instead of passing a recovered AST', async ({
  onTestFinished,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'rstest-type-syntax-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'test.test-d.ts');
  await writeFile(path, 'const value: = ;');
  const file = await collectTypeTests(path, {
    name: 'types',
    normalizedConfig: { globals: false, includeTaskLocation: false },
  });
  expect(file.errors.length).toBeGreaterThan(0);
  expect(file.tests).toEqual([]);
});
