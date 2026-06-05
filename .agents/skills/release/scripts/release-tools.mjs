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
 *   preflight                   Pre-release environment checks (exit 1 on any failure)
 *   bump-menu                   Print bumpp's native commit list + version menu, non-mutating
 *   verify-bump-commit          Check HEAD is a well-formed bump commit (only package.json
 *                               version bumps, all public packages present and consistent)
 *   extract-stage-ids <run-id>  Print package@version<TAB>stage-id table from a CI run log
 *   approve-staged <run-id>     INTERACTIVE: approve all staged packages with one OTP
 *   verify-live <version>       Check every public package is live on npm (parallel)
 */
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { promisify, stripVTControlCharacters } from 'node:util';

const REPO = 'web-infra-dev/rstest';
const STAGED_PACKAGES_URL = 'https://www.npmjs.com/settings/rstest/packages';
const execFileAsync = promisify(execFile);

/** Run a command and return its stdout; throws on non-zero exit. */
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, {
    encoding: 'utf8',
    // CI run logs can be tens of MB
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });

const repoRoot = () => run('git', ['rev-parse', '--show-toplevel']).trim();

/**
 * Manifests of all npm-published (non-private) workspace packages.
 * Single source of truth — never hardcode the list, it changes over time.
 */
function publicPackageManifests() {
  const packagesDir = join(repoRoot(), 'packages');
  const manifests = [];
  for (const dir of readdirSync(packagesDir)) {
    let pkg;
    try {
      pkg = JSON.parse(
        readFileSync(join(packagesDir, dir, 'package.json'), 'utf8'),
      );
    } catch {
      continue;
    }
    if (!pkg.private && pkg.name) {
      manifests.push({ name: pkg.name, version: pkg.version, dir });
    }
  }
  return manifests.sort((a, b) => a.name.localeCompare(b.name));
}

/** Split "@scope/name@1.2.3" into { name, version } (survives scoped names). */
function splitSpec(spec) {
  const at = spec.lastIndexOf('@');
  return { name: spec.slice(0, at), version: spec.slice(at + 1) };
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
        'release', 'list', '--repo', REPO,
        '--exclude-drafts', '--exclude-pre-releases',
        '--limit', '1', '--json', 'tagName',
      ]),
    );
    const tag = releases[0]?.tagName;
    if (!tag) throw new Error('no published releases found');
    return tag;
  });

  const version = check('public package versions consistent', () => {
    const manifests = publicPackageManifests();
    if (manifests.length === 0) throw new Error('no public packages found');
    const versions = new Set(manifests.map((m) => m.version));
    if (versions.size !== 1) {
      throw new Error(
        `mixed versions: ${manifests.map((m) => `${m.name}@${m.version}`).join(', ')}`,
      );
    }
    return `${manifests.length} packages at ${manifests[0].version}`;
  });

  // The skill's Step 3 dispatch command and its npm_tag foot-gun warning are
  // written against release.yml's current inputs — fail fast if they drift.
  check('release.yml inputs match the skill assumptions', () => {
    const workflow = readFileSync(
      join(repoRoot(), '.github/workflows/release.yml'),
      'utf8',
    );
    for (const expected of ['npm_tag:', 'branch:', "default: 'alpha'"]) {
      if (!workflow.includes(expected)) {
        throw new Error(
          `release.yml no longer contains \`${expected}\` — update the release skill (Step 3) to match`,
        );
      }
    }
    return '';
  });

  if (failed) {
    console.log('Preflight failed — resolve the issues above before releasing.');
    process.exit(1);
  }
  console.log(`Preflight OK. Last release: ${lastTag}, current: ${version}`);
}

/**
 * bumpp has no --dry-run flag. With stdin at EOF (stdio 'ignore'), the
 * interactive version prompt aborts cleanly AFTER printing the commits since
 * the last tag (--print-commits) and the full version menu, with no file
 * writes and no commit. Verified empirically against bumpp 11.1.0 — and
 * enforced at runtime below, so a future bumpp that behaves differently
 * fails loudly instead of silently mutating package.json files.
 */
function bumpMenu() {
  const cwd = repoRoot();
  const statusBefore = run('git', ['status', '--porcelain'], { cwd });
  const result = spawnSync('pnpm', ['bump', '--print-commits'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const statusAfter = run('git', ['status', '--porcelain'], { cwd });
  if (statusAfter !== statusBefore) {
    console.error('ERROR: bump-menu modified the working tree — bumpp\'s');
    console.error('EOF-abort behavior has changed. Inspect `git status`,');
    console.error('restore the touched package.json files, and update this script.');
    process.exit(1);
  }
  const lines = stripVTControlCharacters(
    `${result.stdout ?? ''}${result.stderr ?? ''}`,
  )
    .split('\n')
    // prompt cursor/selection glyphs at line start
    .map((l) => l.replace(/^\s*[?❯›…]+\s*/, '').trimEnd())
    .filter((l) => l.trim() !== '');
  // collapse consecutive duplicates left behind by prompt re-renders
  const out = lines.filter((line, i) => line !== lines[i - 1]);
  console.log(out.join('\n'));
}

/**
 * Check that HEAD is a well-formed `pnpm bump` commit:
 *   - it touches nothing but packages/<pkg>/package.json files
 *   - every public package is included
 *   - every touched manifest now carries the same new version
 * The expected file set is derived from the workspace, so this stays correct
 * when packages are added or bump.config.mts exclusions change.
 */
function verifyBumpCommit() {
  const changed = run('git', ['show', '--name-only', '--format=', 'HEAD'])
    .trim()
    .split('\n')
    .filter(Boolean);

  const stray = changed.filter(
    (f) => !/^packages\/[^/]+\/package\.json$/.test(f),
  );
  if (stray.length) {
    console.error('HEAD touches files that are not package manifests:');
    for (const f of stray) console.error(`  ${f}`);
    process.exit(1);
  }

  const manifests = publicPackageManifests();
  const missing = manifests.filter(
    (m) => !changed.includes(`packages/${m.dir}/package.json`),
  );
  if (missing.length) {
    console.error(
      `HEAD does not bump these public packages: ${missing.map((m) => m.name).join(', ')}`,
    );
    process.exit(1);
  }

  const versions = new Set(manifests.map((m) => m.version));
  if (versions.size !== 1) {
    console.error(
      `Public package versions diverge after the bump: ${manifests.map((m) => `${m.name}@${m.version}`).join(', ')}`,
    );
    process.exit(1);
  }

  const [version] = versions;
  console.log(
    `Bump commit OK: ${changed.length} manifest(s) changed, ${manifests.length} public packages at ${version}.`,
  );
}

/**
 * Parse `package@version → stage-id` pairs from a release workflow run.
 * `pnpm stage publish` prints one line per package in the `Release` job:
 *   + @rstest/core@0.10.4 (staged with id 8f98b2c9-9cb9-4799-85fa-effd60b117bc)
 * (format verified against rsbuild release runs, which use the same command).
 *
 * Fetches only the `Release` job's log when it can be resolved — the run also
 * contains a 6-target VS Code packaging matrix whose logs are large and never
 * contain stage lines. Falls back to the full run log if the job lookup fails.
 *
 * Returns { entries: [pkgSpec, stageId][], mismatch: string | null }.
 */
function extractStageIds(runId) {
  let log;
  try {
    const { jobs } = JSON.parse(
      run('gh', ['run', 'view', runId, '--repo', REPO, '--json', 'jobs']),
    );
    const releaseJob = jobs.find((j) => j.name === 'Release');
    log = run('gh', [
      'run', 'view', '--repo', REPO,
      '--job', String(releaseJob.databaseId), '--log',
    ]);
  } catch {
    log = run('gh', ['run', 'view', runId, '--repo', REPO, '--log']);
  }

  const matches = [
    ...log.matchAll(/\+ (\S+@[^\s)]+) \(staged with id ([0-9a-f-]+)\)/g),
  ];
  const entries = [...new Map(matches.map((m) => [m[1], m[2]]))].sort();

  let mismatch = null;
  if (entries.length > 0) {
    const staged = new Set(entries.map(([spec]) => splitSpec(spec).name));
    const expected = publicPackageManifests().map((m) => m.name);
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

/**
 * Shared front half of `extract-stage-ids` and `approve-staged`: resolve the
 * staged entries, print the table (or the npmjs.com fallback when the log has
 * no stage lines), and return what the caller needs to act on. The two
 * commands only differ in how they treat a set mismatch — extract exits 2 so
 * automation stops, approve warns and lets the human decide.
 */
function loadStagedEntries(runId) {
  const { entries, mismatch } = extractStageIds(runId);
  if (entries.length === 0) {
    console.error(`No 'staged with id' lines found in run ${runId}.`);
    console.error('Fallback: check the Staged Packages tab on npmjs.com:');
    console.error(STAGED_PACKAGES_URL);
    process.exit(1);
  }
  for (const [spec, id] of entries) console.log(`${spec}\t${id}`);
  if (mismatch) {
    console.error('');
    console.error(
      `WARNING: staged packages do not match the public workspace packages (${mismatch}).`,
    );
  }
  return { entries, mismatch };
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
  const { entries, mismatch } = loadStagedEntries(runId);
  if (mismatch) console.error('Continue only if you understand why.');

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
      console.log(
        `  failed: ${spec} — re-run this command, or approve on ${STAGED_PACKAGES_URL}`,
      );
    }
  }
  const { version } = splitSpec(entries[0][0]);
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
    publicPackageManifests().map(async ({ name }) => {
      try {
        const { stdout } = await execFileAsync('npm', [
          'view', `${name}@${version}`, 'version',
        ]);
        return [name, stdout.trim() === version];
      } catch {
        return [name, false];
      }
    }),
  );
  let missing = 0;
  for (const [name, live] of results) {
    console.log(live ? `  ✅ ${name}@${version}` : `  ⏳ ${name}@${version} not live yet`);
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
  console.error(
    'usage: release-tools.mjs <preflight|bump-menu|verify-bump-commit|extract-stage-ids <run-id>|approve-staged <run-id>|verify-live <version>>',
  );
  process.exit(64);
};

switch (command) {
  case 'preflight':
    preflight();
    break;
  case 'bump-menu':
    bumpMenu();
    break;
  case 'verify-bump-commit':
    verifyBumpCommit();
    break;
  case 'extract-stage-ids': {
    if (!args[0]) usage();
    const { mismatch } = loadStagedEntries(args[0]);
    if (mismatch) process.exit(2);
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
