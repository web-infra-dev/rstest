import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, onTestFinished } from '@rstest/core';
import { prepareFixtures, runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const changedFixturePath = join(__dirname, 'fixtures-changed');
const coverageFixturePath = join(__dirname, '../test-coverage/fixtures');

const collectRunTestFileLogs = (stdout: string) =>
  stdout
    .split('\n')
    .filter((log) => log.includes('.test.ts') && !log.startsWith('::error'))
    .sort();

const prepareChangedFixture = async (name: string) => {
  const fixturesTargetPath = await mkdtemp(join(tmpdir(), `rstest-${name}-`));

  onTestFinished(() =>
    rm(fixturesTargetPath, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 500,
    }),
  );

  const { fs } = await prepareFixtures({
    fixturesPath: changedFixturePath,
    fixturesTargetPath,
  });
  await symlink(
    join(coverageFixturePath, 'node_modules'),
    join(fixturesTargetPath, 'node_modules'),
    'dir',
  );

  return { fixturesTargetPath, fs };
};

const readCoverageFiles = async (cwd: string): Promise<string[]> => {
  const coverage = JSON.parse(
    await readFile(join(cwd, 'coverage/coverage-final.json'), 'utf8'),
  ) as Record<string, unknown>;

  return Object.keys(coverage)
    .map((file) => file.replaceAll('\\', '/'))
    .sort();
};

const runGit = async (cwd: string, args: string[]) => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  await execFileAsync('git', args, { cwd });
};

const commitFixture = (cwd: string, message: string) =>
  runGit(cwd, [
    '-c',
    'user.name=rstest',
    '-c',
    'user.email=rstest@example.com',
    'commit',
    '-m',
    message,
  ]);

const changedArgsFor = (state: string) =>
  state === 'committed' ? '--changed=HEAD~1' : '--changed';

const initGitFixture = async (cwd: string) => {
  await runGit(cwd, ['-c', 'init.defaultBranch=main', 'init']);
  await runGit(cwd, ['add', '.']);
  await commitFixture(cwd, 'init');
};

describe('changed test filtering', () => {
  it('should ignore compilation errors in unrelated files for --related', async () => {
    const { fixturesTargetPath } = await prepareChangedFixture(
      'related-compile-error',
    );
    await writeFile(
      join(fixturesTargetPath, 'src/index.ts'),
      'export const value = ;\n',
    );
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--related', 'src/other.ts'],
      options: { nodeOptions: { cwd: fixturesTargetPath } },
    });

    await expectExecSuccess();

    expect(collectRunTestFileLogs(cli.stdout)).toEqual([
      ' ✓ other.test.ts (1)',
    ]);
    expect(cli.stderr).not.toContain('Build error');
  });

  it('should warn when a test file that failed to build cannot be analyzed', async () => {
    const { fixturesTargetPath } = await prepareChangedFixture(
      'related-broken-test',
    );
    await writeFile(
      join(fixturesTargetPath, 'index.test.ts'),
      "import { sayHi } from './src/index';\n\nexport const broken = ;\n",
    );
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--related', 'src/other.ts'],
      options: { nodeOptions: { cwd: fixturesTargetPath } },
    });

    await expectExecSuccess();

    expect(collectRunTestFileLogs(cli.stdout)).toEqual([
      ' ✓ other.test.ts (1)',
    ]);
    expect(cli.stderr).toContain('Related test selection may be incomplete');
    expect(cli.stderr).not.toContain('Build error');
  });

  it.each(['unstaged', 'staged', 'committed'])(
    'should select importers of a %s deleted source',
    async (state) => {
      const { fixturesTargetPath } = await prepareChangedFixture(
        `deleted-${state}`,
      );
      await initGitFixture(fixturesTargetPath);
      await rm(join(fixturesTargetPath, 'src/index.ts'));
      if (state !== 'unstaged') await runGit(fixturesTargetPath, ['add', '-u']);
      if (state === 'committed') {
        await commitFixture(fixturesTargetPath, 'delete source');
      }

      const changed = changedArgsFor(state);
      const { cli, expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: ['list', '--filesOnly', changed],
        options: { nodeOptions: { cwd: fixturesTargetPath } },
      });
      await expectExecSuccess();
      expect(cli.stdout.split('\n').filter(Boolean)).toEqual(['index.test.ts']);

      const run = await runRstestCli({
        command: 'rstest',
        args: ['run', changed, '--passWithNoTests'],
        options: { nodeOptions: { cwd: fixturesTargetPath } },
      });
      await run.expectExecFailed();
      expect(run.cli.log).toContain('index.test.ts');
      expect(run.cli.log).not.toContain('No changed files found');
      expect(run.cli.log).not.toContain('other.test.ts');
      expect(run.cli.stderr).not.toContain(
        'Related test selection may be incomplete',
      );
    },
  );

  it.each([
    [
      'json',
      'src/data.json',
      '{"value": 1}\n',
      "import data from './src/data.json';\nimport { expect, it } from '@rstest/core';\nit('x', () => { expect(data.value).toBe(1); });\n",
    ],
    [
      'mjs',
      'src/data.mjs',
      'export const value = 1;\n',
      "import { value } from './src/data.mjs';\nimport { expect, it } from '@rstest/core';\nit('x', () => { expect(value).toBe(1); });\n",
    ],
  ])(
    'should keep importers of a deleted %s source',
    async (name, deletedFile, content, testSource) => {
      const { fixturesTargetPath } = await prepareChangedFixture(
        `deleted-${name}`,
      );
      await writeFile(join(fixturesTargetPath, deletedFile), content);
      await writeFile(
        join(fixturesTargetPath, `deleted-${name}.test.ts`),
        testSource,
      );
      await initGitFixture(fixturesTargetPath);
      await rm(join(fixturesTargetPath, deletedFile));
      await runGit(fixturesTargetPath, ['add', '-u']);

      const { cli, expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: ['list', '--filesOnly', '--changed'],
        options: { nodeOptions: { cwd: fixturesTargetPath } },
      });
      await expectExecSuccess();
      expect(cli.stdout.split('\n').filter(Boolean)).toEqual([
        `deleted-${name}.test.ts`,
      ]);
    },
  );

  it('should select importers when a changed file is replaced by a directory', async () => {
    const { fixturesTargetPath } = await prepareChangedFixture('file-to-dir');
    await initGitFixture(fixturesTargetPath);
    await rm(join(fixturesTargetPath, 'src/index.ts'));
    await mkdir(join(fixturesTargetPath, 'src/index.ts'));
    await writeFile(
      join(fixturesTargetPath, 'src/index.ts/readme.txt'),
      'replacement\n',
    );
    await runGit(fixturesTargetPath, ['add', '-A']);

    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['list', '--filesOnly', '--changed'],
      options: { nodeOptions: { cwd: fixturesTargetPath } },
    });
    await expectExecSuccess();
    expect(cli.stdout.split('\n').filter(Boolean)).toEqual(['index.test.ts']);
  });

  it.each(['staged', 'committed'])(
    'should keep both paths when a %s rename drops the old import target',
    async (state) => {
      const { fixturesTargetPath } = await prepareChangedFixture(
        `renamed-${state}`,
      );
      await initGitFixture(fixturesTargetPath);
      await runGit(fixturesTargetPath, [
        'mv',
        'src/index.ts',
        'src/renamed.ts',
      ]);
      if (state === 'committed') {
        await commitFixture(fixturesTargetPath, 'rename source');
      }

      const changed = changedArgsFor(state);
      const { cli, expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: ['list', '--filesOnly', changed],
        options: { nodeOptions: { cwd: fixturesTargetPath } },
      });
      await expectExecSuccess();
      expect(cli.stdout.split('\n').filter(Boolean)).toEqual(['index.test.ts']);

      const run = await runRstestCli({
        command: 'rstest',
        args: ['run', changed, '--passWithNoTests'],
        options: { nodeOptions: { cwd: fixturesTargetPath } },
      });
      await run.expectExecFailed();
      expect(run.cli.log).toContain('index.test.ts');
    },
  );

  it.each(['staged', 'committed'])(
    'should run all tests for a %s deleted force rerun trigger',
    async (state) => {
      const { fixturesTargetPath } = await prepareChangedFixture(
        `deleted-trigger-${state}`,
      );
      await writeFile(join(fixturesTargetPath, 'package.json'), '{}\n');
      await initGitFixture(fixturesTargetPath);
      await rm(join(fixturesTargetPath, 'package.json'));
      await runGit(fixturesTargetPath, ['add', '-u']);
      if (state === 'committed') {
        await commitFixture(fixturesTargetPath, 'delete trigger');
      }
      const { cli, expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: ['run', changedArgsFor(state)],
        options: { nodeOptions: { cwd: fixturesTargetPath } },
      });
      await expectExecSuccess();
      expect(collectRunTestFileLogs(cli.stdout)).toEqual([
        ' ✓ index.test.ts (1)',
        ' ✓ other.test.ts (1)',
      ]);
      expect(cli.stdout).toContain('matched forceRerunTriggers');
    },
  );

  it('should reject changed with positional filters', async () => {
    const { cli, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--changed=HEAD', 'src/index.ts'],
      options: {
        nodeOptions: {
          cwd: changedFixturePath,
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
          cwd: changedFixturePath,
        },
      },
    });

    await expectExecFailed();

    expect(cli.stderr).toContain(
      'Options `--related`, `--findRelatedTests`, and `--changed` cannot be used together.',
    );
  });

  it('should print a clear error when changed cannot read Git state', async () => {
    const { fixturesTargetPath } =
      await prepareChangedFixture('changed-no-git');

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
      'Failed to resolve changed files for `--changed` from ',
    );
    expect(cli.stderr).toContain(
      '. Make sure the current root is inside a Git repository.',
    );
    expect(cli.stderr).toContain('Git error:');
  });

  it('should run tests related to changed files', async () => {
    const { fixturesTargetPath, fs } =
      await prepareChangedFixture('changed-files');

    await initGitFixture(fixturesTargetPath);

    fs.update(join(fixturesTargetPath, 'src/index.ts'), (content) =>
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
    const { fixturesTargetPath, fs } =
      await prepareChangedFixture('changed-commit');

    await initGitFixture(fixturesTargetPath);

    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: fixturesTargetPath,
      encoding: 'utf8',
    });
    const baseCommit = stdout.trim();

    fs.update(join(fixturesTargetPath, 'src/other.ts'), (content) =>
      content.replace("greet('other')", "greet('other changed')"),
    );
    await runGit(fixturesTargetPath, ['add', '.']);
    await runGit(fixturesTargetPath, [
      '-c',
      'user.name=rstest',
      '-c',
      'user.email=rstest@example.com',
      'commit',
      '-m',
      'change other',
    ]);
    fs.update(join(fixturesTargetPath, 'src/index.ts'), (content) =>
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

  it('should only report coverage for changed source files', async () => {
    const { fixturesTargetPath, fs } =
      await prepareChangedFixture('changed-coverage');

    await writeFile(
      join(fixturesTargetPath, 'rstest.config.ts'),
      `import { defineConfig } from '@rstest/core';

export default defineConfig({
  coverage: {
    enabled: true,
    include: ['src/**/*.ts'],
    reporters: ['json'],
  },
});
`,
    );
    await initGitFixture(fixturesTargetPath);

    fs.update(
      join(fixturesTargetPath, 'src/index.ts'),
      (content) => `${content}\nexport const changed = true;\n`,
    );

    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--changed'],
      options: {
        nodeOptions: {
          cwd: fixturesTargetPath,
        },
      },
    });

    await expectExecSuccess();

    const coverageFiles = await readCoverageFiles(fixturesTargetPath);

    expect(coverageFiles.some((file) => file.endsWith('/src/index.ts'))).toBe(
      true,
    );
    expect(coverageFiles.some((file) => file.endsWith('/src/other.ts'))).toBe(
      false,
    );
    expect(coverageFiles.some((file) => file.endsWith('/src/shared.ts'))).toBe(
      false,
    );
  });

  it('should report full coverage when coverage.changed is false with changed test filtering', async () => {
    const { fixturesTargetPath, fs } = await prepareChangedFixture(
      'changed-coverage-disabled',
    );

    await writeFile(
      join(fixturesTargetPath, 'rstest.config.ts'),
      `import { defineConfig } from '@rstest/core';

export default defineConfig({
  coverage: {
    enabled: true,
    changed: false,
    include: ['src/**/*.ts'],
    reporters: ['json'],
  },
});
`,
    );
    await initGitFixture(fixturesTargetPath);

    fs.update(
      join(fixturesTargetPath, 'src/index.ts'),
      (content) => `${content}\nexport const changed = true;\n`,
    );

    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--changed'],
      options: {
        nodeOptions: {
          cwd: fixturesTargetPath,
        },
      },
    });

    await expectExecSuccess();

    const coverageFiles = await readCoverageFiles(fixturesTargetPath);

    expect(coverageFiles.some((file) => file.endsWith('/src/index.ts'))).toBe(
      true,
    );
    expect(coverageFiles.some((file) => file.endsWith('/src/other.ts'))).toBe(
      true,
    );
    expect(coverageFiles.some((file) => file.endsWith('/src/shared.ts'))).toBe(
      true,
    );
  });

  it('should only report coverage for files from coverage.changed without filtering tests', async () => {
    const { fixturesTargetPath, fs } =
      await prepareChangedFixture('coverage-changed');

    await writeFile(
      join(fixturesTargetPath, 'rstest.config.ts'),
      `import { defineConfig } from '@rstest/core';

export default defineConfig({
  coverage: {
    enabled: true,
    include: ['src/**/*.ts'],
    reporters: ['json'],
  },
});
`,
    );
    await initGitFixture(fixturesTargetPath);

    fs.update(
      join(fixturesTargetPath, 'src/index.ts'),
      (content) => `${content}\nexport const changed = true;\n`,
    );

    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--coverage.changed'],
      options: {
        nodeOptions: {
          cwd: fixturesTargetPath,
        },
      },
    });

    await expectExecSuccess();

    const logs = collectRunTestFileLogs(cli.stdout);
    expect(logs).toEqual([' ✓ index.test.ts (1)', ' ✓ other.test.ts (1)']);

    const coverageFiles = await readCoverageFiles(fixturesTargetPath);

    expect(coverageFiles.some((file) => file.endsWith('/src/index.ts'))).toBe(
      true,
    );
    expect(coverageFiles.some((file) => file.endsWith('/src/other.ts'))).toBe(
      false,
    );
    expect(coverageFiles.some((file) => file.endsWith('/src/shared.ts'))).toBe(
      false,
    );
  });

  it('should let coverage.changed override changed coverage filters', async () => {
    const { fixturesTargetPath, fs } = await prepareChangedFixture(
      'coverage-changed-override',
    );

    await writeFile(
      join(fixturesTargetPath, 'rstest.config.ts'),
      `import { defineConfig } from '@rstest/core';

export default defineConfig({
  coverage: {
    enabled: true,
    include: ['src/**/*.ts'],
    reporters: ['json'],
  },
});
`,
    );
    await initGitFixture(fixturesTargetPath);

    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: fixturesTargetPath,
      encoding: 'utf8',
    });
    const baseCommit = stdout.trim();

    fs.update(
      join(fixturesTargetPath, 'src/other.ts'),
      (content) => `${content}\nexport const otherChanged = true;\n`,
    );
    await runGit(fixturesTargetPath, ['add', '.']);
    await runGit(fixturesTargetPath, [
      '-c',
      'user.name=rstest',
      '-c',
      'user.email=rstest@example.com',
      'commit',
      '-m',
      'change other',
    ]);
    fs.update(
      join(fixturesTargetPath, 'src/index.ts'),
      (content) => `${content}\nexport const indexChanged = true;\n`,
    );

    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', `--changed=${baseCommit}`, '--coverage.changed=HEAD'],
      options: {
        nodeOptions: {
          cwd: fixturesTargetPath,
        },
      },
    });

    await expectExecSuccess();

    const coverageFiles = await readCoverageFiles(fixturesTargetPath);

    expect(coverageFiles.some((file) => file.endsWith('/src/index.ts'))).toBe(
      true,
    );
    expect(coverageFiles.some((file) => file.endsWith('/src/other.ts'))).toBe(
      false,
    );
  });

  it('should let explicit coverage.changed limit coverage for force reruns', async () => {
    const { fixturesTargetPath, fs } = await prepareChangedFixture(
      'coverage-changed-force-rerun',
    );

    await writeFile(
      join(fixturesTargetPath, 'rstest.config.ts'),
      `import { defineConfig } from '@rstest/core';

export default defineConfig({
  coverage: {
    enabled: true,
    include: ['src/**/*.ts'],
    reporters: ['json'],
  },
});
`,
    );
    await initGitFixture(fixturesTargetPath);

    fs.update(
      join(fixturesTargetPath, 'src/index.ts'),
      (content) => `${content}\nexport const changed = true;\n`,
    );
    await writeFile(
      join(fixturesTargetPath, 'package.json'),
      `${JSON.stringify({ name: 'coverage-changed-force-rerun', version: '1.0.1' })}\n`,
    );

    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--changed', '--coverage.changed'],
      options: {
        nodeOptions: {
          cwd: fixturesTargetPath,
        },
      },
    });

    await expectExecSuccess();

    const logs = collectRunTestFileLogs(cli.stdout);
    expect(logs).toEqual([' ✓ index.test.ts (1)', ' ✓ other.test.ts (1)']);

    const coverageFiles = await readCoverageFiles(fixturesTargetPath);

    expect(coverageFiles.some((file) => file.endsWith('/src/index.ts'))).toBe(
      true,
    );
    expect(coverageFiles.some((file) => file.endsWith('/src/other.ts'))).toBe(
      false,
    );
    expect(coverageFiles.some((file) => file.endsWith('/src/shared.ts'))).toBe(
      false,
    );
  });

  it('should report full coverage when a force rerun trigger changes', async () => {
    const { fixturesTargetPath } = await prepareChangedFixture(
      'changed-coverage-force-rerun',
    );

    await writeFile(
      join(fixturesTargetPath, 'rstest.config.ts'),
      `import { defineConfig } from '@rstest/core';

export default defineConfig({
  coverage: {
    enabled: true,
    include: ['src/**/*.ts'],
    reporters: ['json'],
  },
});
`,
    );
    await initGitFixture(fixturesTargetPath);

    await writeFile(
      join(fixturesTargetPath, 'package.json'),
      `${JSON.stringify({ name: 'changed-coverage-force-rerun', version: '1.0.1' })}\n`,
    );

    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--changed'],
      options: {
        nodeOptions: {
          cwd: fixturesTargetPath,
        },
      },
    });

    await expectExecSuccess();

    const coverageFiles = await readCoverageFiles(fixturesTargetPath);

    expect(coverageFiles.some((file) => file.endsWith('/src/index.ts'))).toBe(
      true,
    );
    expect(coverageFiles.some((file) => file.endsWith('/src/other.ts'))).toBe(
      true,
    );
    expect(coverageFiles.some((file) => file.endsWith('/src/shared.ts'))).toBe(
      true,
    );
  });

  it('should run all tests when a force rerun trigger changes', async () => {
    const { fixturesTargetPath } = await prepareChangedFixture(
      'changed-force-rerun',
    );

    await initGitFixture(fixturesTargetPath);

    await writeFile(
      join(fixturesTargetPath, 'package.json'),
      `${JSON.stringify({ name: 'changed-force-rerun', version: '1.0.1' })}\n`,
    );

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

    expect(cli.stdout).toContain(
      'Changed file(package.json) matched forceRerunTriggers, running all test files.',
    );
    expect(cli.stdout).toContain(
      'Changed file(package.json) matched forceRerunTriggers, running all test files.\n\n',
    );

    const logs = collectRunTestFileLogs(cli.stdout);

    expect(logs).toMatchInlineSnapshot(`
      [
        " ✓ index.test.ts (1)",
        " ✓ other.test.ts (1)",
      ]
    `);
  });

  it('should list extra changed files when multiple force rerun triggers change', async () => {
    const { fixturesTargetPath } = await prepareChangedFixture(
      'changed-force-rerun-multiple',
    );

    await initGitFixture(fixturesTargetPath);

    await writeFile(
      join(fixturesTargetPath, 'package.json'),
      `${JSON.stringify({ name: 'changed-force-rerun', version: '1.0.1' })}\n`,
    );
    await writeFile(
      join(fixturesTargetPath, 'rstest.config.ts'),
      [
        'export default {',
        "  forceRerunTriggers: ['package.json', 'rstest.config.ts', 'src/shared.ts'],",
        '};',
        '',
      ].join('\n'),
    );
    await writeFile(
      join(fixturesTargetPath, 'src/shared.ts'),
      'export const greet = (name: string) => `Hi, ${name}!`;\n',
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

    expect(cli.stdout).toContain(
      'Changed files(package.json and 2 files) matched forceRerunTriggers, running all test files.',
    );
    expect(cli.stdout).toContain(
      'Changed files(package.json and 2 files) matched forceRerunTriggers, running all test files.\n\n',
    );

    const logs = collectRunTestFileLogs(cli.stdout);

    expect(logs).toMatchInlineSnapshot(`
      [
        " ✗ index.test.ts (1)",
        " ✗ other.test.ts (1)",
      ]
    `);
  });

  it('should pass when changed finds no files', async () => {
    const { fixturesTargetPath } = await prepareChangedFixture('changed-empty');

    await initGitFixture(fixturesTargetPath);

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

    expect(cli.stdout).toContain(
      'No changed files found, exiting with code 0.',
    );
  });

  it('should report no coverage files when coverage.changed finds no files', async () => {
    const { fixturesTargetPath } = await prepareChangedFixture(
      'coverage-changed-empty',
    );

    await writeFile(
      join(fixturesTargetPath, 'rstest.config.ts'),
      `import { defineConfig } from '@rstest/core';

export default defineConfig({
  coverage: {
    enabled: true,
    include: ['src/**/*.ts'],
    reporters: ['json'],
  },
});
`,
    );
    await initGitFixture(fixturesTargetPath);

    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--coverage.changed'],
      options: {
        nodeOptions: {
          cwd: fixturesTargetPath,
        },
      },
    });

    await expectExecSuccess();
    await expect(readCoverageFiles(fixturesTargetPath)).resolves.toEqual([]);
  });
});
