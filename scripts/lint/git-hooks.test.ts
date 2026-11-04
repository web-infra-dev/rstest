// cspell:ignore gpgsign
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from '@rstest/core';

const root = path.resolve(__dirname, '../..');
const zero = '0'.repeat(40);
let cwd: string;
let base: string;

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function commit(file: string, content = '// changed\n') {
  mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  writeFileSync(path.join(cwd, file), content);
  git('add', file);
  git('commit', '-qm', 'fixture');
  return git('rev-parse', 'HEAD');
}

function push(updates: [string, string][], fail = '') {
  return spawnSync('sh', ['.rstack/hooks/_/pre-push', 'origin', '.'], {
    cwd,
    encoding: 'utf8',
    input: updates
      .map(
        ([local, remote], index) =>
          `refs/heads/local${index} ${local} refs/heads/remote${index} ${remote}\n`,
      )
      .join(''),
    env: { ...process.env, FAIL_CHECK: fail },
  });
}

const checks = () =>
  readFileSync(path.join(cwd, 'checks.log'), 'utf8').trim().split('\n');

function installPreCommit() {
  rmSync(path.join(cwd, 'rstack.config.mjs'));
  mkdirSync(path.join(cwd, 'scripts/lint'));
  for (const file of [
    '.rstack/hooks/pre-commit',
    'rstack.config.mts',
    'scripts/lint/os-agnostic-rule.ts',
  ]) {
    writeFileSync(path.join(cwd, file), readFileSync(path.join(root, file)));
  }
}

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), 'rstest-pre-push-'));
  git('init', '-q');
  git('config', 'user.name', 'Rstest');
  git('config', 'user.email', 'rstest@example.com');
  git('config', 'commit.gpgsign', 'false');
  // Fixture commits must not invoke the developer's hooks.
  git('config', 'core.hooksPath', '.git/hooks');
  symlinkSync(
    path.join(root, 'node_modules'),
    path.join(cwd, 'node_modules'),
    'dir',
  );
  mkdirSync(path.join(cwd, '.rstack/hooks'), { recursive: true });
  mkdirSync(path.join(cwd, 'scripts'));
  for (const file of ['.rstack/hooks/pre-push', 'scripts/prePush.mjs']) {
    writeFileSync(path.join(cwd, file), readFileSync(path.join(root, file)));
  }
  writeFileSync(path.join(cwd, '.gitignore'), 'node_modules/\n*.log\n');
  writeFileSync(
    path.join(cwd, 'record.mjs'),
    [
      "import { appendFileSync } from 'node:fs';",
      'const check = process.argv[2];',
      "appendFileSync('checks.log', `${check}\\n`);",
      'if (process.env.FAIL_CHECK === check) process.exit(7);',
      '',
    ].join('\n'),
  );
  writeFileSync(
    path.join(cwd, 'rstack.config.mjs'),
    "import { define } from 'rstack';\ndefine.fmt({ singleQuote: true });\n",
  );
  writeFileSync(
    path.join(cwd, 'package.json'),
    `${JSON.stringify(
      {
        private: true,
        scripts: Object.fromEntries(
          ['build', 'lint:type', 'check-spell', 'check-dependency-version'].map(
            (name) => [name, `node record.mjs ${name}`],
          ),
        ),
      },
      null,
      2,
    )}\n`,
  );
  git('add', '.');
  git('commit', '-qm', 'base');
  base = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', base);
  execFileSync(path.join(root, 'node_modules/.bin/rs'), ['hooks', '--force'], {
    cwd,
  });
});

afterEach(() => rmSync(cwd, { recursive: true, force: true }));

it('skips build for a Markdown-only update while checking formatting and spelling', () => {
  const result = push([[commit('docs/guide.mdx', '# Guide\n'), base]]);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Format check passed');
  expect(checks()).toEqual(['check-spell']);
});

it('checks all new branch commits, including a root config before a docs commit', () => {
  commit('config.mts');
  const result = push([[commit('README.md', '# Readme\n'), zero]]);
  expect(result.status).toBe(0);
  expect(checks()).toEqual(['build', 'lint:type', 'check-spell']);
});

it('skips build on a new docs branch without including shared history', () => {
  expect(push([[commit('README.md', '# Readme\n'), zero]]).status).toBe(0);
  expect(checks()).toEqual(['check-spell']);
});

it.each(['package.json', 'packages/example/package.json'])(
  'checks dependency versions for %s across multiple refs',
  (file) => {
    const docs = commit('README.md', '# Readme\n');
    git('checkout', '--detach', base);
    const manifest =
      file === 'package.json'
        ? `${JSON.stringify({ ...JSON.parse(readFileSync(path.join(cwd, file), 'utf8')), name: 'fixture' }, null, 2)}\n`
        : '{}\n';
    const result = push([
      [docs, base],
      [commit(file, manifest), base],
    ]);
    expect(result.status).toBe(0);
    expect(checks()).toEqual([
      'build',
      'lint:type',
      'check-spell',
      'check-dependency-version',
    ]);
  },
);

it('handles deleted refs without trying to diff the zero SHA', () => {
  expect(push([[zero, base]]).status).toBe(0);
  expect(checks()).toEqual(['check-spell']);
});

it('checks a force-push with a non-ancestor remote tip and unusual filenames', () => {
  const remote = commit('old.ts');
  git('checkout', '--detach', base);
  const result = push([[commit('docs/line\nbreak.mdx', '# Guide\n'), remote]]);
  expect(result.status).toBe(0);
  expect(checks()).toEqual(['build', 'lint:type', 'check-spell']);
});

it('stops the push when a check fails', () => {
  const result = push([[commit('config.mts'), base]], 'build');
  expect(result.status).not.toBe(0);
  expect(checks()).toEqual(['build']);
});

it('formats staged files and preserves unstaged changes', () => {
  const file = path.join(cwd, 'example.js');
  const padding = '// separate the edits\n'.repeat(10);
  commit('example.js', `const value = 1;\n${padding}const other = 2;\n`);
  installPreCommit();
  writeFileSync(file, `const value=3\n${padding}const other = 2;\n`);
  git('add', 'example.js');
  writeFileSync(file, `const value=3\n${padding}const other = 4;\n`);
  const result = spawnSync('sh', ['.rstack/hooks/_/pre-commit'], {
    cwd,
    encoding: 'utf8',
  });
  expect(result.status).toBe(0);
  expect(git('show', ':example.js')).toBe(
    `const value = 3;\n${padding}const other = 2;`,
  );
  expect(readFileSync(file, 'utf8')).toBe(
    `const value = 3;\n${padding}const other = 4;\n`,
  );
});

it('allows ignored-only and unsupported-only staged files', () => {
  installPreCommit();
  for (const file of ['skills-lock.json', 'example.unknown']) {
    writeFileSync(path.join(cwd, file), '  unsupported content\n');
    git('add', file);
    const result = spawnSync('sh', ['.rstack/hooks/_/pre-commit'], {
      cwd,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(
      execFileSync('git', ['show', `:${file}`], { cwd, encoding: 'utf8' }),
    ).toBe('  unsupported content\n');
    git('reset', '--quiet', 'HEAD', file);
  }
});

it('rejects invalid staged syntax and restores the index', () => {
  installPreCommit();
  writeFileSync(path.join(cwd, 'broken.js'), 'const value = ;\n');
  git('add', 'broken.js');
  const before = git('diff', '--cached');
  const result = spawnSync('sh', ['.rstack/hooks/_/pre-commit'], {
    cwd,
    encoding: 'utf8',
  });
  expect(result.status).not.toBe(0);
  expect(git('diff', '--cached')).toBe(before);
});
