#!/usr/bin/env node
/**
 * Release tooling for the rstest monorepo — every deterministic step of the
 * release skill as one Node CLI. No shell scripts: structured parsing, set
 * comparison, and error paths are all plain JavaScript so they cannot fail
 * silently the way `set -e` + pipelines can.
 *
 * Usage: node release-tools.mjs <command> [args]
 *
 * Commands:
 *   packages                    List public (npm-published) workspace packages
 *   preflight                   Pre-release environment checks (exit 1 on any failure)
 *   bump-menu                   Print bumpp's native commit list + version menu, non-mutating
 *   extract-stage-ids <run-id>  Print package@version<TAB>stage-id table from a CI run log
 *   approve-staged <run-id>     INTERACTIVE: approve all staged packages with one OTP
 *   verify-live <version>       Check every public package is live on npm (parallel)
 */
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { promisify } from 'node:util';

const DEFAULT_REPO = 'web-infra-dev/rstest';
const STAGED_PACKAGES_URL = 'https://www.npmjs.com/settings/rstest/packages';
const execFileAsync = promisify(execFile);

/** Run a command and return trimmed stdout; throws on non-zero exit. */
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, {
    encoding: 'utf8',
    // CI run logs can be tens of MB
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });

const repoRoot = () => run('git', ['rev-parse', '--show-toplevel']).trim();

/**
 * Names of all npm-published (non-private) workspace packages.
 * Single source of truth — never hardcode the list, it changes over time.
 */
function publicPackages() {
  const packagesDir = join(repoRoot(), 'packages');
  const names = [];
  for (const dir of readdirSync(packagesDir)) {
    let pkg;
    try {
      pkg = JSON.parse(
        readFileSync(join(packagesDir, dir, 'package.json'), 'utf8'),
      );
    } catch {
      continue;
    }
    if (!pkg.private && pkg.name) names.push(pkg.name);
  }
  return names.sort();
}

function preflight() {
  let failed = false;
  const check = (label, fn) => {
    try {
      const detail = fn();
      console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`);
      return detail;
    } catch (e) {
      const reason = String(e.message || e).split('\n')[0];
      console.log(`  ❌ ${label} — ${reason}`);
      failed = true;
      return null;
    }
  };

  console.log('Release preflight:');

  check('gh authenticated', () => {
    run('gh', ['auth', 'status'], { stdio: ['ignore', 'pipe', 'pipe'] });
    return '';
  });

  check('working tree clean', () => {
    const dirty = run('git', ['status', '--porcelain']).trim();
    if (dirty) throw new Error(`${dirty.split('\n').length} dirty path(s)`);
    return '';
  });

  check('HEAD is at origin/main', () => {
    run('git', ['fetch', 'origin', 'main', '--quiet']);
    const head = run('git', ['rev-parse', 'HEAD']).trim();
    const main = run('git', ['rev-parse', 'origin/main']).trim();
    if (head !== main) {
      throw new Error(
        `HEAD=${head.slice(0, 8)} origin/main=${main.slice(0, 8)}`,
      );
    }
    return head.slice(0, 8);
  });

  const lastTag = check('latest release tag resolved', () => {
    const releases = JSON.parse(
      run('gh', [
        'release', 'list', '--repo', DEFAULT_REPO,
        '--exclude-drafts', '--exclude-pre-releases',
        '--limit', '1', '--json', 'tagName',
      ]),
    );
    const tag = releases[0]?.tagName;
    if (!tag) throw new Error('no published releases found');
    return tag;
  });

  const version = check('current version resolved', () => {
    const pkg = JSON.parse(
      readFileSync(join(repoRoot(), 'packages/core/package.json'), 'utf8'),
    );
    if (!pkg.version) throw new Error('packages/core has no version');
    return pkg.version;
  });

  check('public packages enumerated', () => {
    const count = publicPackages().length;
    if (count === 0) throw new Error('no public packages found');
    return `${count} packages`;
  });

  if (failed) {
    console.log('Preflight failed — resolve the issues above before releasing.');
    process.exit(1);
  }
  console.log(`Preflight OK. Last release: ${lastTag}, current version: ${version}`);
}

/**
 * bumpp has no --dry-run flag. With stdin at EOF (stdio 'ignore'), the
 * interactive version prompt aborts cleanly AFTER printing the commits since
 * the last tag (--print-commits) and the full version menu, with no file
 * writes and no commit. Verified empirically against bumpp 11.1.0.
 */
function bumpMenu() {
  const result = spawnSync('pnpm', ['bump', '--print-commits'], {
    cwd: repoRoot(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = `${result.stdout ?? ''}${result.stderr ?? ''}`
    // ANSI escape sequences and prompt-redraw control codes
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .split('\n')
    // prompt cursor/selection glyphs at line start
    .map((l) => l.replace(/^\s*[?❯›…]+\s*/, '').trimEnd())
    .filter((l) => l.trim() !== '');
  // collapse consecutive duplicates left behind by prompt re-renders
  const out = lines.filter((line, i) => line !== lines[i - 1]);
  console.log(out.join('\n'));
}

/**
 * Parse `package@version → stage-id` pairs from a release workflow run log.
 * `pnpm stage publish` prints one line per package:
 *   + @rstest/core@0.10.4 (staged with id 8f98b2c9-9cb9-4799-85fa-effd60b117bc)
 * (format verified against rsbuild release runs, which use the same command).
 *
 * Returns { entries: [pkgSpec, stageId][], mismatch: string | null }.
 */
function extractStageIds(runId, repo = DEFAULT_REPO) {
  const log = run('gh', ['run', 'view', runId, '--repo', repo, '--log']);
  const matches = [
    ...log.matchAll(/\+ (\S+@[^\s)]+) \(staged with id ([0-9a-f-]+)\)/g),
  ];
  const entries = [...new Map(matches.map((m) => [m[1], m[2]]))].sort();

  let mismatch = null;
  if (entries.length > 0 && repo === DEFAULT_REPO) {
    const staged = new Set(
      entries.map(([spec]) => spec.slice(0, spec.lastIndexOf('@'))),
    );
    const expected = publicPackages();
    const missing = expected.filter((p) => !staged.has(p));
    const unexpected = [...staged].filter((p) => !expected.includes(p));
    if (missing.length || unexpected.length) {
      mismatch = [
        missing.length ? `missing: ${missing.join(', ')}` : '',
        unexpected.length ? `unexpected: ${unexpected.join(', ')}` : '',
      ].filter(Boolean).join('; ');
    }
  }
  return { entries, mismatch };
}

function printStageIds(runId, repo) {
  const { entries, mismatch } = extractStageIds(runId, repo);
  if (entries.length === 0) {
    console.error(`No 'staged with id' lines found in run ${runId}.`);
    console.error('Fallback: check the Staged Packages tab on npmjs.com:');
    console.error(STAGED_PACKAGES_URL);
    process.exit(1);
  }
  for (const [spec, id] of entries) console.log(`${spec}\t${id}`);
  if (mismatch) {
    console.error('');
    console.error(`WARNING: staged packages do not match the public workspace packages (${mismatch}).`);
    process.exit(2);
  }
}

/**
 * INTERACTIVE — a maintainer runs this directly; agents must not run it.
 *
 * `npm stage approve` only accepts one stage-id at a time, but it takes
 * `--otp`, so one TOTP code is reused for all packages as long as the loop
 * finishes within the code's validity window (~30-60s; plain API calls, so
 * normally fast). If a later approve is rejected because the code expired,
 * re-run — already-approved packages fail harmlessly and the rest get the
 * fresh code. Requires a logged-in npm account with publish access and 2FA.
 */
async function approveStaged(runId) {
  const { entries, mismatch } = extractStageIds(runId);
  if (entries.length === 0) {
    console.error(`No staged packages found in run ${runId}. Check the run id,`);
    console.error(`or approve on the web instead: ${STAGED_PACKAGES_URL}`);
    process.exit(1);
  }
  console.log('Staged packages to approve:');
  for (const [spec, id] of entries) console.log(`  ${spec}\t${id}`);
  if (mismatch) {
    console.error(`\nWARNING: staged set does not match public workspace packages (${mismatch}).`);
    console.error('Continue only if you understand why.');
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const otp = (await rl.question('\nEnter OTP (from your authenticator): ')).trim();
  rl.close();

  let failures = 0;
  for (const [spec, id] of entries) {
    console.log(`→ approving ${spec} (${id})`);
    const result = spawnSync('npm', ['stage', 'approve', id, '--otp', otp], {
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      failures += 1;
      console.log(`  failed: ${spec} — re-run this command, or approve on ${STAGED_PACKAGES_URL}`);
    }
  }
  const version = entries[0][0].slice(entries[0][0].lastIndexOf('@') + 1);
  console.log(`\nDone (${entries.length - failures}/${entries.length} approved).`);
  console.log(`Verify with: node ${process.argv[1]} verify-live ${version}`);
  process.exit(failures > 0 ? 1 : 0);
}

/**
 * Uses unauthenticated `npm view`, so it can run anywhere. Staged-but-not-
 * approved versions are NOT visible to `npm view`, which is exactly what
 * makes this the gate between "maintainer approved" and "safe to merge/tag".
 */
async function verifyLive(version) {
  const results = await Promise.all(
    publicPackages().map(async (pkg) => {
      try {
        const { stdout } = await execFileAsync('npm', [
          'view', `${pkg}@${version}`, 'version',
        ]);
        return [pkg, stdout.trim() === version];
      } catch {
        return [pkg, false];
      }
    }),
  );
  let missing = 0;
  for (const [pkg, live] of results) {
    console.log(live ? `  ✅ ${pkg}@${version}` : `  ⏳ ${pkg}@${version} not live yet`);
    if (!live) missing += 1;
  }
  if (missing > 0) {
    console.log('Not all packages are live. Staged versions stay invisible until approved.');
    process.exit(1);
  }
  console.log(`All packages live on npm at ${version}.`);
}

// --- CLI dispatch ---

const [command, ...args] = process.argv.slice(2);
const usage = () => {
  console.error('usage: release-tools.mjs <packages|preflight|bump-menu|extract-stage-ids <run-id> [--repo owner/repo]|approve-staged <run-id>|verify-live <version>>');
  process.exit(64);
};

switch (command) {
  case 'packages':
    console.log(publicPackages().join('\n'));
    break;
  case 'preflight':
    preflight();
    break;
  case 'bump-menu':
    bumpMenu();
    break;
  case 'extract-stage-ids': {
    const runId = args[0];
    if (!runId) usage();
    const repoFlag = args.indexOf('--repo');
    printStageIds(runId, repoFlag !== -1 ? args[repoFlag + 1] : DEFAULT_REPO);
    break;
  }
  case 'approve-staged':
    if (!args[0]) usage();
    await approveStaged(args[0]);
    break;
  case 'verify-live':
    if (!args[0]) usage();
    await verifyLive(args[0]);
    break;
  default:
    usage();
}
