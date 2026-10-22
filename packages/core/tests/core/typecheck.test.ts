import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { Rstest } from '../../src/core/rstest';
import { collectTypeTests } from '../../src/core/typecheck/collect';
import { parseDiagnostics } from '../../src/core/typecheck/checker';
import { mergeRstestConfig, withDefaultConfig } from '../../src/config';
import { mergeWithCLIOptions } from '../../src/cli/init';

it('merges typecheck leaves and replaces include/exclude arrays', () => {
  const config = mergeRstestConfig(
    { typecheck: { enabled: true, include: ['a.ts'], tsconfig: 'test.json' } },
    { typecheck: { include: ['b.ts'] } },
  );
  expect(config.typecheck).toEqual({
    enabled: true,
    include: ['b.ts'],
    tsconfig: 'test.json',
  });
  expect(
    mergeWithCLIOptions(config, { typecheck: { only: true } }).typecheck,
  ).toEqual({
    enabled: true,
    only: true,
    include: ['b.ts'],
    tsconfig: 'test.json',
  });
  expect(
    withDefaultConfig({ typecheck: { only: true } }).typecheck.enabled,
  ).toBe(true);
});

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
  const context = new Rstest(
    { cwd: root, command: 'list', embedded: true, projects: [] },
    { root, includeTaskLocation: true },
  );
  const file = await collectTypeTests(path, context.projects[0]!);
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
    const context = new Rstest(
      { cwd: root, command: 'list', embedded: true, projects: [] },
      { root },
    );
    expect(
      (await collectTypeTests(path, context.projects[0]!)).errors,
    ).toHaveLength(1);
  },
);
