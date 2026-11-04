import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const git = (args, input) =>
  execFileSync('git', args, { encoding: 'utf8', input });

const files = new Set();
const remote = process.argv[2];
const updates = readFileSync(0, 'utf8').trim();

for (const update of updates ? updates.split('\n') : []) {
  const [, localSha, , remoteSha] = update.trim().split(/\s+/);
  if (/^0+$/.test(localSha)) {
    continue;
  }

  let changed;
  if (/^0+$/.test(remoteSha)) {
    // New branches have no remote tip: inspect every commit not on the remote.
    const commits = git([
      'rev-list',
      localSha,
      '--not',
      remote ? `--remotes=${remote}` : '--remotes',
    ]);
    changed = git(
      [
        'diff-tree',
        '--stdin',
        '--root',
        '-m',
        '-r',
        '--no-commit-id',
        '--name-only',
        '--no-renames',
        '-z',
      ],
      commits,
    );
  } else {
    changed = git([
      'diff',
      '--name-only',
      '--no-renames',
      '-z',
      remoteSha,
      localSha,
    ]);
  }
  for (const file of changed.split('\0').filter(Boolean)) {
    files.add(file);
  }
}

try {
  // Build first: it generates LICENSE.md, which the formatting check reads.
  if ([...files].some((file) => !/\.mdx?$/.test(file))) {
    execSync('pnpm run build && pnpm run lint:type', { stdio: 'inherit' });
  }
  execSync('pnpm exec rs fmt --check && pnpm run check-spell', {
    stdio: 'inherit',
  });
  if ([...files].some((file) => /(^|\/)package\.json$/.test(file))) {
    execSync('pnpm run check-dependency-version', { stdio: 'inherit' });
  }
} catch (error) {
  process.exitCode = error.status || 1;
}
