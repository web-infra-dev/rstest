import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalize } from 'pathe';
import { describe, expect, it, onTestFinished, rs } from '@rstest/core';
import {
  createCli,
  getForceRerunTriggerFiles,
  getForceRerunTriggers,
  hasForceRerunTrigger,
  normalizeCliFilters,
  resolveChangedFiles,
  validateRelatedCliOptions,
} from '../../src/cli/commands';

const renderHelp = (argv: string[]): string => {
  const logs: string[] = [];

  rs.spyOn(console, 'info').mockImplementation((...args) => {
    logs.push(args.join(' '));
  });

  onTestFinished(() => {
    rs.resetAllMocks();
  });

  createCli().parse(argv, { run: false });

  return logs.join('\n');
};

describe('CLI help output', () => {
  it('shows list-specific options for list help', () => {
    const help = renderHelp(['node', 'rstest', 'list', '--help']);

    expect(help).toContain('--summary');
    expect(help).toContain('--filesOnly');
    expect(help).toContain('--changed');
    expect(help).toContain('--coverage.changed');
    expect(help).not.toContain('--cleanup');
  });

  it('shows only init-specific options for init help', () => {
    const help = renderHelp(['node', 'rstest', 'init', '--help']);

    expect(help).toContain('--yes');
    expect(help).not.toContain('--coverage');
    expect(help).not.toContain('--reporter');
    expect(help).not.toContain('--browser');
  });

  it('shows only merge-reports options for merge-reports help', () => {
    const help = renderHelp(['node', 'rstest', 'merge-reports', '--help']);

    expect(help).toContain('--cleanup');
    expect(help).toContain('--coverage');
    expect(help).toContain('--reporter');
    expect(help).toContain('--config-loader');
    expect(help).not.toContain('--browser');
    expect(help).not.toContain('--update');
    expect(help).not.toContain('--testTimeout');
  });

  it('rejects unrelated runtime options for init', () => {
    const cli = createCli();

    expect(() =>
      cli.parse(['node', 'rstest', 'init', '--coverage'], { run: true }),
    ).toThrow('Unknown option `--coverage`');
  });

  it('allows --coverage to be mixed with nested coverage options', () => {
    const parsed = createCli().parse(
      ['node', 'rstest', 'run', '--coverage', '--coverage.changed=HEAD'],
      { run: false },
    );

    expect(parsed.options.coverage).toEqual({
      enabled: true,
      changed: 'HEAD',
    });
  });

  it('normalizes --coverage before value-taking coverage options', () => {
    const parsed = createCli().parse(
      ['node', 'rstest', 'run', '--coverage', '--config', 'rstest.config.ts'],
      { run: false },
    );

    expect(parsed.options.coverage).toEqual({
      enabled: true,
    });
    expect(parsed.options.config).toBe('rstest.config.ts');
  });

  it('preserves nested coverage options when followed by --coverage', () => {
    const parsed = createCli().parse(
      ['node', 'rstest', 'run', '--coverage.changed=HEAD', '--coverage'],
      { run: false },
    );

    expect(parsed.options.coverage).toEqual({
      changed: 'HEAD',
      enabled: true,
    });
  });

  it('allows --coverage=false to be mixed with nested coverage options', () => {
    const parsed = createCli().parse(
      ['node', 'rstest', 'run', '--coverage=false', '--coverage.changed=HEAD'],
      { run: false },
    );

    expect(parsed.options.coverage).toEqual({
      enabled: 'false',
      changed: 'HEAD',
    });
  });

  it('keeps --coverage intact for merge-reports command', () => {
    const parsed = createCli().parse(
      ['node', 'rstest', 'merge-reports', '--coverage'],
      { run: false },
    );

    expect(parsed.options.coverage).toBe(true);
  });

  it('keeps --coverage intact for merge-reports command after global options', () => {
    const parsed = createCli().parse(
      [
        'node',
        'rstest',
        '--config',
        'rstest.config.ts',
        'merge-reports',
        '--coverage',
      ],
      { run: false },
    );

    expect(parsed.options.config).toBe('rstest.config.ts');
    expect(parsed.options.coverage).toBe(true);
  });

  it('allows --pool shorthand to be mixed with nested pool options', () => {
    const parsed = createCli().parse(
      ['node', 'rstest', 'run', '--pool', 'forks', '--pool.maxWorkers', '1'],
      { run: false },
    );

    expect(parsed.options.pool).toEqual({
      type: 'forks',
      maxWorkers: 1,
    });
  });

  it('preserves nested pool options when followed by --pool shorthand', () => {
    const parsed = createCli().parse(
      ['node', 'rstest', 'run', '--pool.maxWorkers', '1', '--pool', 'forks'],
      { run: false },
    );

    expect(parsed.options.pool).toEqual({
      maxWorkers: 1,
      type: 'forks',
    });
  });

  it('allows --pool= shorthand to be mixed with nested pool options', () => {
    const parsed = createCli().parse(
      ['node', 'rstest', 'run', '--pool=forks', '--pool.maxWorkers=1'],
      { run: false },
    );

    expect(parsed.options.pool).toEqual({
      type: 'forks',
      maxWorkers: 1,
    });
  });

  it('allows --browser shorthand to be mixed with nested browser options', () => {
    const parsed = createCli().parse(
      ['node', 'rstest', 'run', '--browser', '--browser.name', 'chromium'],
      { run: false },
    );

    expect(parsed.options.browser).toEqual({
      enabled: true,
      name: 'chromium',
    });
  });

  it('preserves nested browser options when followed by --browser', () => {
    const parsed = createCli().parse(
      ['node', 'rstest', 'run', '--browser.name', 'chromium', '--browser'],
      { run: false },
    );

    expect(parsed.options.browser).toEqual({
      name: 'chromium',
      enabled: true,
    });
  });

  it('allows browser disabling shorthand to be mixed with nested browser options', () => {
    const parsed = createCli().parse(
      ['node', 'rstest', 'run', '--no-browser', '--browser.name', 'chromium'],
      { run: false },
    );

    expect(parsed.options.browser).toEqual({
      enabled: false,
      name: 'chromium',
    });
  });

  it('accepts --reporters and populates options.reporters', () => {
    const parsed = createCli().parse(
      ['node', 'rstest', 'run', '--reporters', 'verbose'],
      { run: false },
    );

    expect(parsed.options.reporters).toBe('verbose');
  });

  it('accepts legacy --reporter as an alias for --reporters', () => {
    const parsed = createCli().parse(
      ['node', 'rstest', 'run', '--reporter', 'verbose', '--reporter=junit'],
      { run: false },
    );

    expect(parsed.options.reporters).toEqual(['verbose', 'junit']);
    expect(parsed.options.reporter).toBeUndefined();
  });
});

describe('normalizeCliFilters', () => {
  it('coerces numeric filters to strings before normalizing them', () => {
    expect(normalizeCliFilters([1, 'tests\\foo.test.ts'])).toEqual([
      '1',
      'tests/foo.test.ts',
    ]);
  });
});

const runGit = async (cwd: string, args: string[]) => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
  });

  return stdout.trim();
};

const createGitFixture = async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'rstest-changed-'));

  onTestFinished(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  await runGit(cwd, ['init']);
  await writeFile(join(cwd, 'base.ts'), 'export const base = 1;\n');
  await runGit(cwd, ['add', '.']);
  await runGit(cwd, [
    '-c',
    'user.name=rstest',
    '-c',
    'user.email=rstest@example.com',
    'commit',
    '-m',
    'init',
  ]);

  return cwd;
};

describe('getForceRerunTriggers', () => {
  it('includes project-level force rerun triggers', () => {
    expect(
      getForceRerunTriggers({
        rootTriggers: ['**/package.json/**', 'shared/rstest.config.ts'],
        projects: [
          {
            normalizedConfig: {
              forceRerunTriggers: ['apps/a/rsbuild.config.ts'],
            },
          },
          {
            normalizedConfig: {
              forceRerunTriggers: [
                'apps/b/rspack.config.ts',
                'shared/rstest.config.ts',
              ],
            },
          },
        ],
      }),
    ).toEqual([
      '**/package.json/**',
      'shared/rstest.config.ts',
      'apps/a/rsbuild.config.ts',
      'apps/b/rspack.config.ts',
    ]);
  });
});

describe('hasForceRerunTrigger', () => {
  it('matches changed files relative to the project root', () => {
    const rootPath = normalize(join('workspace', 'project'));

    expect(
      hasForceRerunTrigger({
        changedFiles: [normalize(join(rootPath, 'packages/app/package.json'))],
        triggers: ['**/package.json/**'],
        rootPath,
      }),
    ).toBe(true);

    expect(
      hasForceRerunTrigger({
        changedFiles: [normalize(join(rootPath, 'rstest.config.ts'))],
        triggers: [normalize(join(rootPath, 'rstest.config.ts'))],
        rootPath,
      }),
    ).toBe(true);

    expect(
      hasForceRerunTrigger({
        changedFiles: [normalize(join(rootPath, 'src/index.ts'))],
        triggers: ['package.json'],
        rootPath,
      }),
    ).toBe(false);
  });

  it('matches Windows-style absolute triggers', () => {
    const rootPath = 'C:\\repo';

    expect(
      hasForceRerunTrigger({
        changedFiles: ['C:\\repo\\rsbuild.config.ts'],
        triggers: ['C:\\repo\\rsbuild.config.ts'],
        rootPath,
      }),
    ).toBe(true);
  });
});

describe('getForceRerunTriggerFiles', () => {
  it('returns only changed files that match force rerun triggers', () => {
    const rootPath = normalize(join('workspace', 'project'));
    const packageJson = normalize(join(rootPath, 'package.json'));
    const configFile = normalize(join(rootPath, 'rstest.config.ts'));

    expect(
      getForceRerunTriggerFiles({
        changedFiles: [
          packageJson,
          normalize(join(rootPath, 'src/index.ts')),
          configFile,
        ],
        triggers: ['package.json', configFile],
        rootPath,
      }),
    ).toEqual([packageJson, configFile]);
  });
});

describe('related CLI options', () => {
  it('rejects related aliases used together', () => {
    expect(() =>
      validateRelatedCliOptions({ related: true, findRelatedTests: true }),
    ).toThrow(
      'Options `--related`, `--findRelatedTests`, and `--changed` cannot be used together.',
    );

    expect(() =>
      validateRelatedCliOptions({ related: true, changed: true }),
    ).toThrow(
      'Options `--related`, `--findRelatedTests`, and `--changed` cannot be used together.',
    );
  });

  it('treats changed commit values as related runs', () => {
    validateRelatedCliOptions({ changed: 'HEAD' });

    expect(() =>
      validateRelatedCliOptions({ changed: 'HEAD', related: true }),
    ).toThrow(
      'Options `--related`, `--findRelatedTests`, and `--changed` cannot be used together.',
    );
  });

  it('wraps git errors when resolving changed files', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'rstest-changed-no-git-'));

    onTestFinished(async () => {
      await rm(cwd, { recursive: true, force: true });
    });

    await expect(resolveChangedFiles(cwd)).rejects.toThrow(
      `Failed to resolve changed files for \`--changed\` from ${normalize(cwd)}. Make sure the current root is inside a Git repository.`,
    );
  });

  it('resolves changed files from the Git root as absolute paths', async () => {
    const cwd = await createGitFixture();
    const nestedDir = join(cwd, 'packages/app');

    await writeFile(join(cwd, 'base.ts'), 'export const base = 2;\n');
    await writeFile(join(cwd, 'staged.ts'), 'export const staged = 1;\n');
    await writeFile(join(cwd, 'untracked.ts'), 'export const untracked = 1;\n');
    await mkdir(nestedDir, { recursive: true });
    await runGit(cwd, ['add', 'staged.ts']);

    await expect(resolveChangedFiles(nestedDir)).resolves.toEqual([
      normalize(join(cwd, 'base.ts')),
      normalize(join(cwd, 'staged.ts')),
      normalize(join(cwd, 'untracked.ts')),
    ]);
  });

  it('preserves special changed file paths', async () => {
    const cwd = await createGitFixture();
    const files = [' leading-space.ts', 'unicode-你好.ts'];

    await Promise.all(
      files.map((file) =>
        writeFile(join(cwd, file), 'export const value = 1;\n'),
      ),
    );

    await expect(resolveChangedFiles(cwd)).resolves.toEqual(
      expect.arrayContaining(files.map((file) => normalize(join(cwd, file)))),
    );
  });

  it('combines committed, staged, and unstaged files since a commit', async () => {
    const cwd = await createGitFixture();
    const baseCommit = await runGit(cwd, ['rev-parse', 'HEAD']);

    await writeFile(join(cwd, 'committed.ts'), 'export const committed = 1;\n');
    await runGit(cwd, ['add', '.']);
    await runGit(cwd, [
      '-c',
      'user.name=rstest',
      '-c',
      'user.email=rstest@example.com',
      'commit',
      '-m',
      'change committed',
    ]);
    await writeFile(join(cwd, 'staged.ts'), 'export const staged = 1;\n');
    await writeFile(join(cwd, 'unstaged.ts'), 'export const unstaged = 1;\n');
    await runGit(cwd, ['add', 'staged.ts']);

    await expect(resolveChangedFiles(cwd, baseCommit)).resolves.toEqual([
      normalize(join(cwd, 'committed.ts')),
      normalize(join(cwd, 'staged.ts')),
      normalize(join(cwd, 'unstaged.ts')),
    ]);
  });
});
