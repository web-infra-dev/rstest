import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, onTestFinished } from '@rstest/core';
import { prepareFixtures, runRstestCli } from '../scripts';

const directory = dirname(fileURLToPath(import.meta.url));

async function prepareNativeFixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'rstest-native-related-'));
  onTestFinished(() =>
    rm(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }),
  );
  await prepareFixtures({
    fixturesPath: join(directory, 'fixtures-native-related'),
    fixturesTargetPath: cwd,
  });
  await symlink(
    join(directory, '../node_modules'),
    join(cwd, 'node_modules'),
    'junction',
  );
  return cwd;
}

async function invoke(cwd: string, args: string[], complete = false) {
  await rm(join(cwd, 'report.json'), { force: true });
  return runRstestCli({
    command: 'rstest',
    args,
    options: {
      nodeOptions: {
        cwd,
        env: {
          COMPLETE_NATIVE_INPUTS: complete ? '1' : '0',
          NATIVE_PROVIDER: 'provider',
        },
      },
    },
  });
}

async function listed(cwd: string, source: string, complete = false) {
  const result = await invoke(
    cwd,
    ['list', '--filesOnly', '--related', source],
    complete,
  );
  await result.expectExecSuccess();
  return result.cli.stdout.split('\n').filter(Boolean).sort();
}

async function report(cwd: string) {
  const value: {
    summary: { testFiles: number; passedTests: number; failedTests: number };
    files: { testPath: string; status: string }[];
  } = JSON.parse(await readFile(join(cwd, 'report.json'), 'utf8'));
  return value;
}

describe('native related test filtering', () => {
  it('selects a native helper through a CommonJS var require redeclaration', async () => {
    const cwd = await prepareNativeFixture();
    await (await invoke(cwd, ['run'])).expectExecSuccess();
    expect((await report(cwd)).summary).toMatchObject({
      testFiles: 2,
      passedTests: 2,
    });
    expect(await listed(cwd, 'native/helper.cjs')).toEqual(['price.test.mjs']);
    expect(await listed(cwd, 'README.md')).toEqual([]);

    await writeFile(join(cwd, 'native/helper.cjs'), 'module.exports = 99;\n');
    await (await invoke(cwd, ['run'])).expectExecFailed();
    const full = await report(cwd);
    expect(full.summary).toMatchObject({
      testFiles: 2,
      failedTests: 1,
      passedTests: 1,
    });
    expect(full.files.map((file) => file.testPath).sort()).toEqual([
      'price.test.mjs',
      'stock.test.mjs',
    ]);
    expect(full.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ testPath: 'price.test.mjs', status: 'fail' }),
        expect.objectContaining({ testPath: 'stock.test.mjs', status: 'pass' }),
      ]),
    );
    await (
      await invoke(cwd, ['run', '--related', 'native/helper.cjs'])
    ).expectExecFailed();
    const selected = await report(cwd);
    expect(selected.summary).toMatchObject({ testFiles: 1, failedTests: 1 });
    expect(selected.files.map((file) => file.testPath)).toEqual([
      'price.test.mjs',
    ]);
  });

  it('requires a complete declaration for an unproven computed request', async () => {
    const cwd = await prepareNativeFixture();
    await writeFile(
      join(cwd, 'price.test.mjs'),
      `import { expect, it } from '@rstest/core';
const provider = process.env.NATIVE_PROVIDER || 'provider';
it('reads the chosen price provider', () => {
  expect(require(\`./native/\${provider}.cjs\`)).toBe(42);
});
`,
    );
    await (await invoke(cwd, ['run'])).expectExecSuccess();
    const automatic = await invoke(cwd, [
      'list',
      '--filesOnly',
      '--related',
      'native/helper.cjs',
    ]);
    await automatic.expectExecFailed();
    expect(automatic.cli.log).toContain('unproven runtime path domain');

    expect(await listed(cwd, 'native/helper.cjs', true)).toEqual([
      'price.test.mjs',
    ]);
    expect(await listed(cwd, 'README.md', true)).toEqual([]);
    await writeFile(join(cwd, 'native/helper.cjs'), 'module.exports = 99;\n');
    await (
      await invoke(cwd, ['run', '--related', 'native/helper.cjs'], true)
    ).expectExecFailed();
    const selected = await report(cwd);
    expect(selected.summary).toMatchObject({ testFiles: 1, failedTests: 1 });
    expect(selected.files.map((file) => file.testPath)).toEqual([
      'price.test.mjs',
    ]);
  });

  it('rejects escaped native module APIs instead of silently omitting their inputs', async () => {
    const cwd = await prepareNativeFixture();
    await writeFile(
      join(cwd, 'price.test.mjs'),
      `import { expect, it } from '@rstest/core';
import { createRequire as makeRequire } from 'node:module';
const factory = makeRequire;
const load = factory(import.meta.url);
it('reads the native price provider', () => {
  expect(load('./native/provider.cjs')).toBe(42);
});
`,
    );
    await (await invoke(cwd, ['run'])).expectExecSuccess();
    const automatic = await invoke(cwd, [
      'list',
      '--filesOnly',
      '--related',
      'native/helper.cjs',
    ]);
    await automatic.expectExecFailed();
    expect(automatic.cli.log).toContain('native-module-capability');
    expect(await listed(cwd, 'native/helper.cjs', true)).toEqual([
      'price.test.mjs',
    ]);
    expect(await listed(cwd, 'README.md', true)).toEqual([]);
  });
});
