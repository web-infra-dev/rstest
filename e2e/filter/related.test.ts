import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const relatedFixturePath = join(__dirname, 'fixtures-related');
const dynamicFixturePath = join(__dirname, '../fixtures/fan-out-dynamic');
const mixedFixturePath = join(__dirname, 'fixtures-related-mixed');
const transitiveFixturePath = join(__dirname, 'fixtures-transitive');

const collectRunTestFileLogs = (stdout: string) =>
  stdout
    .split('\n')
    .filter((log) => log.includes('.test.ts'))
    .sort();

const collectListedFiles = (stdout: string) =>
  stdout.split('\n').filter(Boolean);

describe('related test filtering', () => {
  it('should select tests for a loader-declared build input', async () => {
    const args = [
      'list',
      '--filesOnly',
      '--related',
      'loader-inputs/manifest.txt',
    ];

    const withoutLoader = await runRstestCli({
      command: 'rstest',
      args,
      options: { nodeOptions: { cwd: relatedFixturePath } },
    });
    await withoutLoader.expectExecSuccess();
    expect(collectListedFiles(withoutLoader.cli.stdout)).toEqual([]);

    const withLoader = await runRstestCli({
      command: 'rstest',
      args: ['--config', 'rstest.loader-input.config.mts', ...args],
      options: { nodeOptions: { cwd: relatedFixturePath } },
    });
    await withLoader.expectExecSuccess();
    expect(collectListedFiles(withLoader.cli.stdout)).toEqual([
      'index.test.ts',
    ]);

    const missingInput = await runRstestCli({
      command: 'rstest',
      args: [
        '--config',
        'rstest.loader-input.config.mts',
        'list',
        '--filesOnly',
        '--related',
        'loader-inputs/optional.txt',
      ],
      options: { nodeOptions: { cwd: relatedFixturePath } },
    });
    await missingInput.expectExecSuccess();
    expect(collectListedFiles(missingInput.cli.stdout)).toEqual([
      'index.test.ts',
    ]);
  });

  it('should not chain build-input dependencies through imports', async () => {
    const listRelated = async (source: string) => {
      const { cli, expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: ['list', '--filesOnly', '--related', source],
        options: { nodeOptions: { cwd: transitiveFixturePath } },
      });
      await expectExecSuccess();
      return collectListedFiles(cli.stdout).sort();
    };

    // `a` only reaches `b` through an import; `c`'s loader reads `b`'s source,
    // so changing `a` must not select the consumer of `b`.
    expect(await listRelated('src/transitive-a.ts')).toEqual([
      'transitive-b.test.ts',
    ]);
    expect(await listRelated('src/transitive-b.ts')).toEqual([
      'transitive-b.test.ts',
      'transitive-c.test.ts',
    ]);
  });

  it('should run only tests related to a leaf source file', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--related', 'src/index.ts'],
      options: {
        nodeOptions: {
          cwd: relatedFixturePath,
        },
      },
    });

    await expectExecSuccess();

    const logs = collectRunTestFileLogs(cli.stdout);

    expect(logs).toMatchInlineSnapshot(`
      [
        " ✓ index.test.ts (1)",
      ]
    `);
  });

  it('should include both test files for a shared dependency', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--related', 'src/shared.ts'],
      options: {
        nodeOptions: {
          cwd: relatedFixturePath,
        },
      },
    });

    await expectExecSuccess();

    const logs = collectRunTestFileLogs(cli.stdout);

    expect(logs).toMatchInlineSnapshot(`
      [
        " ✓ index.test.ts (1)",
        " ✓ other.test.ts (1)",
      ]
    `);
  });

  it('should include tests related through a virtual setup file', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '--config',
        'rstest.virtual.config.mts',
        '--related',
        'src/virtualDependency.ts',
      ],
      options: {
        nodeOptions: {
          cwd: relatedFixturePath,
        },
      },
    });

    await expectExecSuccess();

    const logs = collectRunTestFileLogs(cli.stdout);

    expect(logs).toHaveLength(3);
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.stringContaining('index.test.ts'),
        expect.stringContaining('other.test.ts'),
        expect.stringContaining('fallback.ts.test.ts'),
      ]),
    );
  });

  it('should resolve async dependencies and the Jest alias', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--findRelatedTests', 'src/late.ts'],
      options: {
        nodeOptions: {
          cwd: dynamicFixturePath,
        },
      },
    });

    await expectExecSuccess();

    const logs = collectRunTestFileLogs(cli.stdout);

    expect(logs).toMatchInlineSnapshot(`
      [
        " ✓ index.test.ts (1)",
      ]
    `);
  });

  it('should support list mode with related source filters', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['list', '--related', 'src/shared.ts', '--filesOnly'],
      options: {
        nodeOptions: {
          cwd: relatedFixturePath,
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs).toMatchInlineSnapshot(`
      [
        "index.test.ts",
        "other.test.ts",
      ]
    `);
  });

  it('should print the original related source filter when nothing matches', async () => {
    const { cli, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--related', '404.ts'],
      options: {
        nodeOptions: {
          cwd: relatedFixturePath,
        },
      },
    });

    await expectExecFailed();

    expect(cli.stderr).toContain(
      'No test files found for related source files, exiting with code 1.',
    );
    expect(cli.log).toContain('related:');
    expect(cli.log).toContain('404.ts');
    expect(cli.log).not.toContain('__rstest_related_no_match__');
  });

  it('should not fall back to substring file matching when related finds no tests', async () => {
    const { cli, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--related', 'src/fallback.ts'],
      options: {
        nodeOptions: {
          cwd: relatedFixturePath,
        },
      },
    });

    await expectExecFailed();

    expect(cli.stderr).toContain(
      'No test files found for related source files, exiting with code 1.',
    );
    expect(cli.log).toContain('related:');
    expect(cli.log).toContain('src/fallback.ts');
    expect(cli.log).not.toContain('src/fallback.ts.test.ts');
  });

  it('should not initialize browser related resolution for node-only sources', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--related', 'node/src/index.ts'],
      options: {
        nodeOptions: {
          cwd: mixedFixturePath,
        },
      },
    });

    await expectExecSuccess();

    const logs = collectRunTestFileLogs(cli.stdout);

    expect(logs).toMatchInlineSnapshot(`
      [
        " ✓ [node-project] node/index.test.ts (1)",
      ]
    `);
    expect(cli.log).not.toContain('invalid');
  });

  it('should reject the `watch` command with related filters', async () => {
    const { expectExecFailed, expectStderrLog } = await runRstestCli({
      command: 'rstest',
      args: ['watch', '--related', 'src/index.ts'],
      options: {
        nodeOptions: {
          cwd: relatedFixturePath,
        },
      },
    });

    await expectExecFailed();
    expectStderrLog(
      /`--related`, `--findRelatedTests`, and `--changed` options are not supported in watch mode/,
    );
  });

  it('should reject `--changed` with `--watch` on the default command', async () => {
    const { expectExecFailed, expectStderrLog } = await runRstestCli({
      command: 'rstest',
      args: ['--watch', '--changed'],
      options: {
        nodeOptions: {
          cwd: relatedFixturePath,
        },
      },
    });

    await expectExecFailed();
    expectStderrLog(
      /`--related`, `--findRelatedTests`, and `--changed` options are not supported in watch mode/,
    );
  });

  it('should keep exact related test paths without prefix matching extra files', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['list', '--related', 'index.test.ts', '--filesOnly'],
      options: {
        nodeOptions: {
          cwd: relatedFixturePath,
        },
      },
    });

    await expectExecSuccess();

    expect(cli.stdout.split('\n').filter(Boolean)).toEqual(['index.test.ts']);
  });
});
