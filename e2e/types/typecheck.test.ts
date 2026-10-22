import { mkdtemp, readFile, rm, writeFile, cp } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { expect, test } from '@rstest/core';
import { runRstestCli } from '../scripts';

const fixture = join(__dirname, 'fixtures/typecheck');

async function setup(onTestFinished: (cleanup: () => Promise<void>) => void) {
  const cwd = await mkdtemp(join(__dirname, 'fixtures-test-typecheck-'));
  await cp(fixture, cwd, { recursive: true });
  onTestFinished(() => rm(cwd, { recursive: true, force: true }));
  return cwd;
}

const source = `import { test, expectTypeOf } from '@rstest/core';\ntest('broken assertion', () => { expectTypeOf<number>().toEqualTypeOf<string>(); });\n`;

test('runs static assertions and runtime tests together without executing type files', async () => {
  const { expectExecSuccess, expectLog } = await runRstestCli({
    command: 'rstest',
    options: { nodeOptions: { cwd: fixture } },
    args: ['run', '--reporter', 'verbose'],
  });
  await expectExecSuccess();
  expectLog('return type');
  expectLog('literal name');
  expectLog('runtime assertions remain callable');
});

test('typecheck.only skips runtime files and setup', async ({
  onTestFinished,
}) => {
  const cwd = await setup(onTestFinished);
  await writeFile(
    join(cwd, 'runtime.test.ts'),
    'throw new Error("runtime executed");',
  );
  const { expectExecSuccess, expectLog } = await runRstestCli({
    command: 'rstest',
    options: { nodeOptions: { cwd } },
    args: ['run', '--typecheck.only', '--reporter', 'verbose'],
  });
  await expectExecSuccess();
  expectLog('2 passed');
});

test('reports a compiler diagnostic on the owning case and fails the CLI', async ({
  onTestFinished,
}) => {
  const cwd = await setup(onTestFinished);
  await writeFile(join(cwd, 'basic.test-d.ts'), source);
  const { expectExecFailed, cli } = await runRstestCli({
    command: 'rstest',
    options: { nodeOptions: { cwd } },
    args: ['run', '--typecheck.only'],
  });
  await expectExecFailed();
  expect(cli.log).toContain('broken assertion');
  expect(cli.log).toContain('TS2344');
});

test('fails unused expect-error directives and errors outside tests', async ({
  onTestFinished,
}) => {
  const cwd = await setup(onTestFinished);
  await writeFile(
    join(cwd, 'basic.test-d.ts'),
    `// @ts-expect-error\nconst valid = 1;\nexport {};`,
  );
  const { expectExecFailed, cli } = await runRstestCli({
    command: 'rstest',
    options: { nodeOptions: { cwd } },
    args: ['run', '--typecheck.only'],
  });
  await expectExecFailed();
  expect(cli.log).toContain('TS2578');
});

test.for(['only', 'skip', 'todo', 'each', 'skipIf'])(
  'rejects the %s modifier',
  async (modifier, { onTestFinished }) => {
    const cwd = await setup(onTestFinished);
    await writeFile(
      join(cwd, 'basic.test-d.ts'),
      `import { test } from '@rstest/core';\ntest.${modifier}('unsupported', () => {});`,
    );
    const { expectExecFailed, cli } = await runRstestCli({
      command: 'rstest',
      options: { nodeOptions: { cwd } },
      args: ['run', '--typecheck.only'],
    });
    await expectExecFailed();
    expect(cli.log).toContain(`Type tests do not support test.${modifier}`);
  },
);

test('lists nested static cases with locations without checking or executing them', async () => {
  const { expectExecSuccess, cli } = await runRstestCli({
    command: 'rstest',
    options: { nodeOptions: { cwd: fixture } },
    args: ['list', '--typecheck.only', '--includeTaskLocation'],
  });
  await expectExecSuccess();
  expect(cli.log).toContain('return type');
  expect(cli.log).toContain('literal name');
  expect(cli.log).not.toContain('runtime assertions');
});

test('rejects a type test omitted from the tsconfig', async ({
  onTestFinished,
}) => {
  const cwd = await setup(onTestFinished);
  await writeFile(join(cwd, 'tsconfig.json'), '{"files":["source.ts"]}');
  const { expectExecFailed, cli } = await runRstestCli({
    command: 'rstest',
    options: { nodeOptions: { cwd } },
    args: ['run', '--typecheck.only'],
  });
  await expectExecFailed();
  expect(cli.log).toContain('not included in');
});

test.for([false, true])(
  'rejects type testing in watch mode (only: %s)',
  async (only, { onTestFinished }) => {
    const cwd = await setup(onTestFinished);
    const { expectExecFailed, cli } = await runRstestCli({
      command: 'rstest',
      options: { nodeOptions: { cwd } },
      args: ['watch', ...(only ? ['--typecheck.only'] : [])],
    });
    await expectExecFailed();
    expect(cli.log).toContain('Type testing does not support watch mode');
    expect(cli.log).toContain('rstest run --typecheck');
  },
);

test('checks browser projects on the host without launching a browser', async ({
  onTestFinished,
}) => {
  const cwd = await setup(onTestFinished);
  await writeFile(
    join(cwd, 'rstest.config.mts'),
    `export default { typecheck: { only: true }, browser: { enabled: true, providerOptions: { launch: { executablePath: '/does-not-exist' } } }, setupFiles: ['./never.ts'], globalSetup: ['./never.ts'] };`,
  );
  await writeFile(join(cwd, 'never.ts'), 'throw new Error("setup executed");');
  const { expectExecSuccess } = await runRstestCli({
    command: 'rstest',
    options: { nodeOptions: { cwd } },
    args: ['run'],
  });
  await expectExecSuccess();
});

test('keeps source diagnostics when a case is excluded by a name filter', async ({
  onTestFinished,
}) => {
  const cwd = await setup(onTestFinished);
  await writeFile(join(cwd, 'basic.test-d.ts'), source);
  await writeFile(join(cwd, 'source.ts'), 'export const bad: number = "bad";');
  const { expectExecFailed, cli } = await runRstestCli({
    command: 'rstest',
    options: { nodeOptions: { cwd } },
    args: ['run', '--typecheck.only', '-t', 'not-selected'],
  });
  await expectExecFailed();
  expect(cli.log).toContain('TS2344');
  expect(cli.log).toContain('TS2322');
});

test('rejects runtime/type-test overlap', async ({ onTestFinished }) => {
  const cwd = await setup(onTestFinished);
  await writeFile(
    join(cwd, 'rstest.config.mts'),
    `export default {include:['*.test-d.ts'], typecheck:{enabled:true}};`,
  );
  const { expectExecFailed, cli } = await runRstestCli({
    command: 'rstest',
    options: { nodeOptions: { cwd } },
    args: ['run'],
  });
  await expectExecFailed();
  expect(cli.log).toContain('both runtime and type tests');
});

test('isolates projects and preserves results when a sibling tsconfig fails', async ({
  onTestFinished,
}) => {
  const cwd = await setup(onTestFinished);
  await writeFile(
    join(cwd, 'rstest.config.mts'),
    `export default { projects:[{name:'broken',root:'.',typecheck:{only:true,tsconfig:'missing.json'}},{name:'good',root:'.',typecheck:{only:true}}] };`,
  );
  const { expectExecFailed, cli } = await runRstestCli({
    command: 'rstest',
    options: { nodeOptions: { cwd } },
    args: ['run', '--reporter', 'json'],
  });
  await expectExecFailed();
  const report = JSON.parse(cli.stdout.slice(cli.stdout.indexOf('{')));
  expect(report.tests).toHaveLength(2);
  expect(
    report.tests.every((test: { project: string }) => test.project === 'good'),
  ).toBe(true);
  expect(cli.log).toContain('missing.json');
});

test('supports run/list through the public API with typecheck metadata', async ({
  onTestFinished,
}) => {
  const cwd = await setup(onTestFinished);
  await writeFile(
    join(cwd, 'api.mjs'),
    `import {createRstest} from '@rstest/core/api';
const rstest = await createRstest({cwd:process.cwd(),config:{reporters:[]}});
const list = await rstest.listTests({typecheck:{only:true},includeTaskLocation:true});
const result = await rstest.run({typecheck:{only:true}});
console.log(JSON.stringify({list,status:result.status,files:result.results,tests:result.testResults}));`,
  );
  const { expectExecSuccess, cli } = await runRstestCli({
    command: process.execPath,
    options: { nodeOptions: { cwd } },
    args: ['api.mjs'],
  });
  await expectExecSuccess();
  const result = JSON.parse(cli.stdout.trim());
  expect(result.status).toBe('pass');
  expect(
    result.list.filter((item: { type: string }) => item.type === 'case'),
  ).toHaveLength(2);
  expect(result.files[0].meta).toMatchObject({
    typecheck: true,
    checker: 'tsc',
  });
  expect(
    result.tests.every(
      (test: { meta: { typecheck: boolean } }) => test.meta.typecheck,
    ),
  ).toBe(true);
});

test('fails a checker that exits unsuccessfully without diagnostics', async ({
  onTestFinished,
}) => {
  const cwd = await setup(onTestFinished);
  const { mkdir } = await import('node:fs/promises');
  const packageDir = join(cwd, 'node_modules/typescript');
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    join(packageDir, 'package.json'),
    JSON.stringify({
      name: 'typescript',
      version: '0.0.0',
      bin: { tsc: 'compiler.cjs' },
      exports: { './package.json': './package.json' },
    }),
  );
  await writeFile(
    join(packageDir, 'compiler.cjs'),
    `console.error('compiler crashed');process.exitCode=9;`,
  );
  const { expectExecFailed, cli } = await runRstestCli({
    command: 'rstest',
    options: { nodeOptions: { cwd } },
    args: ['run', '--typecheck.only'],
  });
  await expectExecFailed();
  expect(cli.log).toContain('Type checker failed (exit 9)');
  expect(cli.log).toContain('compiler crashed');
});

test('shards runtime and type files together', async ({ onTestFinished }) => {
  const cwd = await setup(onTestFinished);
  const files: string[] = [];
  for (const shard of ['1/2', '2/2']) {
    const { expectExecSuccess, cli } = await runRstestCli({
      command: 'rstest',
      options: { nodeOptions: { cwd } },
      args: ['run', '--shard', shard, '--reporter', 'json'],
    });
    await expectExecSuccess();
    const report = JSON.parse(cli.stdout.slice(cli.stdout.indexOf('{')));
    expect(report.files).toHaveLength(1);
    files.push(report.files[0].testPath);
  }
  expect(files.sort()).toEqual(['basic.test-d.ts', 'runtime.test.ts']);
});

test('round-trips type results through blob and merge-reports', async ({
  onTestFinished,
}) => {
  const cwd = await setup(onTestFinished);
  const run = await runRstestCli({
    command: 'rstest',
    options: { nodeOptions: { cwd } },
    args: ['run', '--typecheck.only', '--reporter', 'blob'],
  });
  await run.expectExecSuccess();
  const merge = await runRstestCli({
    command: 'rstest',
    options: { nodeOptions: { cwd } },
    args: ['merge-reports', '--reporter', 'json'],
  });
  await merge.expectExecSuccess();
  const report = JSON.parse(
    merge.cli.stdout.slice(merge.cli.stdout.indexOf('{')),
  );
  expect(report.summary.passedTests).toBe(2);
  expect(
    report.tests.every(
      (test: { meta: { typecheck: boolean } }) => test.meta.typecheck,
    ),
  ).toBe(true);
});

test('resolves inherited includes and overrides inherited noCheck', async ({
  onTestFinished,
}) => {
  const cwd = await setup(onTestFinished);
  const config = JSON.parse(await readFile(join(cwd, 'tsconfig.json'), 'utf8'));
  config.compilerOptions.noCheck = true;
  await writeFile(join(cwd, 'base.json'), JSON.stringify(config));
  await writeFile(
    join(cwd, 'tsconfig.json'),
    JSON.stringify({ extends: './base.json' }),
  );
  await writeFile(join(cwd, 'basic.test-d.ts'), source);
  const { expectExecFailed, cli } = await runRstestCli({
    command: 'rstest',
    options: { nodeOptions: { cwd } },
    args: ['run', '--typecheck.only'],
  });
  await expectExecFailed();
  expect(cli.log).toContain('TS2344');
});

test('checks once per run and invalidates incremental results after edits', async ({
  onTestFinished,
}) => {
  const cwd = await setup(onTestFinished);
  const require = createRequire(join(cwd, 'package.json'));
  const metadataPath = require.resolve('typescript/package.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  const compiler = join(dirname(metadataPath), metadata.bin.tsc);
  const { mkdir } = await import('node:fs/promises');
  const packageDir = join(cwd, 'node_modules/typescript');
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    join(packageDir, 'package.json'),
    JSON.stringify({
      name: 'typescript',
      version: metadata.version,
      bin: { tsc: 'compiler.cjs' },
    }),
  );
  await writeFile(
    join(packageDir, 'compiler.cjs'),
    `
const fs = require('node:fs');
fs.appendFileSync('invocations.jsonl', JSON.stringify(process.argv.slice(2)) + '\\n');
const result = require('node:child_process').spawnSync(process.execPath, [${JSON.stringify(compiler)}, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
`,
  );
  const testFile = join(cwd, 'basic.test-d.ts');
  const original = await readFile(testFile, 'utf8');
  for (const [content, fails] of [
    [original, false],
    [source, true],
    [original, false],
  ] as const) {
    await writeFile(testFile, content);
    const run = await runRstestCli({
      command: 'rstest',
      options: { nodeOptions: { cwd } },
      args: ['run', '--typecheck.only'],
    });
    if (fails) {
      await run.expectExecFailed();
      expect(run.cli.log).toContain('TS2344');
    } else await run.expectExecSuccess();
  }
  const invocations = (await readFile(join(cwd, 'invocations.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(invocations).toHaveLength(3);
  for (const args of invocations) {
    expect(args).toContain('--noEmit');
    expect(args).toContain('--listFiles');
  }
});

test('fails a discovered file omitted by the compiler due to extension precedence', async ({
  onTestFinished,
}) => {
  const cwd = await setup(onTestFinished);
  const config = JSON.parse(await readFile(join(cwd, 'tsconfig.json'), 'utf8'));
  config.include = ['*.ts', '*.tsx'];
  config.compilerOptions.jsx = 'preserve';
  await writeFile(join(cwd, 'tsconfig.json'), JSON.stringify(config));
  await writeFile(join(cwd, 'basic.test-d.tsx'), source);
  const { expectExecFailed, cli } = await runRstestCli({
    command: 'rstest',
    options: { nodeOptions: { cwd } },
    args: ['run', '--typecheck.only'],
  });
  await expectExecFailed();
  expect(cli.log).toContain('Type test files were not checked by tsc');
  expect(cli.log).toContain('basic.test-d.tsx');
});
