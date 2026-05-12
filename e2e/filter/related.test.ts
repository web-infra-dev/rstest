import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { prepareFixtures, runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const relatedFixturePath = join(__dirname, 'fixtures-related');
const dynamicFixturePath = join(__dirname, 'fixtures-related-dynamic');
const mixedFixturePath = join(__dirname, 'fixtures-related-mixed');

const collectRunTestFileLogs = (stdout: string) =>
  stdout
    .split('\n')
    .filter((log) => log.includes('.test.ts'))
    .sort();

describe('related test filtering', () => {
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

    expect(cli.stderr).toContain('No test files found, exiting with code 1.');
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

    expect(cli.stderr).toContain('No test files found, exiting with code 1.');
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

  it('should reject changed with positional filters', async () => {
    const { cli, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--changed=HEAD', 'src/index.ts'],
      options: {
        nodeOptions: {
          cwd: relatedFixturePath,
        },
      },
    });

    await expectExecFailed();

    expect(cli.stderr).toContain(
      'The `--changed` option cannot be used with positional filters.',
    );
  });

  it('should reject changed with related options', async () => {
    const { cli, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--changed', '--related'],
      options: {
        nodeOptions: {
          cwd: relatedFixturePath,
        },
      },
    });

    await expectExecFailed();

    expect(cli.stderr).toContain(
      'Options `--related`, `--findRelatedTests`, and `--changed` cannot be used together.',
    );
  });

  it('should print a clear error when changed cannot read Git state', async () => {
    const fixturesTargetPath = join(__dirname, 'fixtures-related-no-git-test');

    await prepareFixtures({
      fixturesPath: relatedFixturePath,
      fixturesTargetPath,
    });

    const { cli, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--changed'],
      options: {
        nodeOptions: {
          cwd: fixturesTargetPath,
          env: {
            GIT_CEILING_DIRECTORIES: dirname(fixturesTargetPath),
          },
        },
      },
    });

    await expectExecFailed();

    expect(cli.stderr).toContain(
      'Failed to resolve changed files for `--changed`. Make sure the current root is inside a Git repository.',
    );
  });

  it('should run tests related to changed files', async () => {
    const fixturesTargetPath = join(__dirname, 'fixtures-related-changed-test');

    const { fs } = await prepareFixtures({
      fixturesPath: relatedFixturePath,
      fixturesTargetPath,
    });

    await runRstestCli({
      command: 'git',
      args: ['-c', 'init.defaultBranch=main', 'init'],
      options: {
        nodeOptions: {
          cwd: fixturesTargetPath,
        },
      },
    }).then(({ expectExecSuccess }) => expectExecSuccess());
    await runRstestCli({
      command: 'git',
      args: ['add', '.'],
      options: {
        nodeOptions: {
          cwd: fixturesTargetPath,
        },
      },
    }).then(({ expectExecSuccess }) => expectExecSuccess());
    await runRstestCli({
      command: 'git',
      args: [
        '-c',
        'user.name=rstest',
        '-c',
        'user.email=rstest@example.com',
        'commit',
        '-m',
        'init',
      ],
      options: {
        nodeOptions: {
          cwd: fixturesTargetPath,
        },
      },
    }).then(({ expectExecSuccess }) => expectExecSuccess());

    fs.update('fixtures-related-changed-test/src/index.ts', (content) =>
      content.replace("greet('index')", "greet('index changed')"),
    );

    const { cli, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--changed'],
      options: {
        nodeOptions: {
          cwd: fixturesTargetPath,
        },
      },
    });

    await expectExecFailed();

    const logs = collectRunTestFileLogs(cli.stdout);

    expect(logs).toMatchInlineSnapshot(`
      [
        " ✗ index.test.ts (1)",
      ]
    `);
  });

  it('should run tests related to files changed since a commit', async () => {
    const fixturesTargetPath = join(
      __dirname,
      'fixtures-related-changed-commit-test',
    );

    const { fs } = await prepareFixtures({
      fixturesPath: relatedFixturePath,
      fixturesTargetPath,
    });

    const runGit = async (args: string[]) => {
      await runRstestCli({
        command: 'git',
        args,
        options: {
          nodeOptions: {
            cwd: fixturesTargetPath,
          },
        },
      }).then(({ expectExecSuccess }) => expectExecSuccess());
    };

    const getHeadCommit = async () => {
      const { cli, expectExecSuccess } = await runRstestCli({
        command: 'git',
        args: ['rev-parse', 'HEAD'],
        options: {
          nodeOptions: {
            cwd: fixturesTargetPath,
          },
        },
      });

      await expectExecSuccess();

      return cli.stdout.trim();
    };

    await runGit(['-c', 'init.defaultBranch=main', 'init']);
    await runGit(['add', '.']);
    await runGit([
      '-c',
      'user.name=rstest',
      '-c',
      'user.email=rstest@example.com',
      'commit',
      '-m',
      'init',
    ]);

    const baseCommit = await getHeadCommit();

    fs.update('fixtures-related-changed-commit-test/src/other.ts', (content) =>
      content.replace("greet('other')", "greet('other changed')"),
    );
    await runGit(['add', '.']);
    await runGit([
      '-c',
      'user.name=rstest',
      '-c',
      'user.email=rstest@example.com',
      'commit',
      '-m',
      'change other',
    ]);
    fs.update('fixtures-related-changed-commit-test/src/index.ts', (content) =>
      content.replace("greet('index')", "greet('index changed')"),
    );

    const { cli, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--changed', baseCommit],
      options: {
        nodeOptions: {
          cwd: fixturesTargetPath,
        },
      },
    });

    await expectExecFailed();

    const logs = collectRunTestFileLogs(cli.stdout);

    expect(logs).toMatchInlineSnapshot(`
      [
        " ✗ index.test.ts (1)",
        " ✗ other.test.ts (1)",
      ]
    `);
  });

  it('should pass when changed finds no files', async () => {
    const fixturesTargetPath = join(
      __dirname,
      'fixtures-related-changed-empty-test',
    );

    await prepareFixtures({
      fixturesPath: relatedFixturePath,
      fixturesTargetPath,
    });

    const runGit = async (args: string[]) => {
      await runRstestCli({
        command: 'git',
        args,
        options: {
          nodeOptions: {
            cwd: fixturesTargetPath,
          },
        },
      }).then(({ expectExecSuccess }) => expectExecSuccess());
    };

    await runGit(['-c', 'init.defaultBranch=main', 'init']);
    await runGit(['add', '.']);
    await runGit([
      '-c',
      'user.name=rstest',
      '-c',
      'user.email=rstest@example.com',
      'commit',
      '-m',
      'init',
    ]);

    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--changed'],
      options: {
        nodeOptions: {
          cwd: fixturesTargetPath,
        },
      },
    });

    await expectExecSuccess();

    expect(cli.stdout).toContain('No test files found, exiting with code 0.');
  });
});
