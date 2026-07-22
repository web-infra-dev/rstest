#!/usr/bin/env node

// Deterministic drift checker for the agent-harness docs (AGENTS.md files and
// .agents/skills/*/SKILL.md). Design: HARNESS_AUDIT.md "Part 2 — drift checker
// design". Modeled on .agents/skills/api-doc-sync/scripts/check-type-blocks.mjs:
// pure Node, zero deps, per-violation messages, non-zero exit on drift.
//
// Checks (all deterministic, no prose/semantic judgment):
//   C1 — every AGENTS.md has a sibling CLAUDE.md that is a symlink to AGENTS.md
//        (git mode 120000 when tracked).
//   C2 — root AGENTS.md references every packages/*/AGENTS.md by path, and its
//        "Monorepo structure" section lists every direct child of packages/.
//   C3 — commands in ```bash fences: `pnpm --filter <pkg> <script>` scripts
//        exist in the target package; `npm run <script>` scripts exist in the
//        doc's owning package; bare `pnpm <script>` resolves to a root script
//        (or, in a package doc, to a root or owning-package script).
//   C4 — inline-code tokens shaped like repo paths exist on disk (resolved
//        against the doc's directory first, then the doc's owning package dir,
//        then the repo root). Trailing
//        `:line` anchors are stripped — paths are validated, line numbers are
//        not. Runtime/output prefixes (dist/, coverage/, node_modules/,
//        .rstest-temp) are skipped by rule, not allowlist.
//   C5 — inline-code npm-name tokens inside `## Dependencies` / `## Tech stack`
//        sections of a package doc must appear in that package's package.json
//        (deps/devDeps/peerDeps/optionalDeps). Bare single-word tokens are only
//        checked when they are a known dependency name somewhere in the
//        workspace, to keep prose words out of scope.
//
// Doc set: tracked plus untracked-but-not-ignored files, so newly written docs
// are gated before their first commit (identical to plain `git ls-files` once
// everything is committed). AGENTS.md is the content source; CLAUDE.md is only
// checked structurally (C1).
//
// Allowlist: scripts/check-harness-docs.allow.json — `{file, token, reason}`
// entries suppress a violation whose doc path and offending token both match.
// Every entry must carry a reason; review entries in PR like code.
//
// Usage:
//   node scripts/check-harness-docs.mjs          # human output, exit 1 on drift
//   node scripts/check-harness-docs.mjs --json   # machine-readable violations
//
// Non-goals (see HARNESS_AUDIT.md): no prose/behavioral checking, no signature
// checking (api-doc-sync owns that), no auto-fix.

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { argv, exit, stdout } from 'node:process';

const asJson = argv.slice(2).includes('--json');

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
}

/** Repo-relative doc paths: every AGENTS.md and every skill SKILL.md. */
const docFiles = git([
  'ls-files',
  '--cached',
  '--others',
  '--exclude-standard',
  '--',
  '*AGENTS.md',
  '.agents/skills/*/SKILL.md',
])
  .split('\n')
  .filter(Boolean)
  .sort();

/** Git index modes for CLAUDE.md files, path → mode (e.g. '120000'). */
const trackedClaudeModes = new Map(
  git(['ls-files', '-s', '--', '*CLAUDE.md'])
    .split('\n')
    .filter(Boolean)
    // `git ls-files -s` line shape: `<mode> <hash> <stage>\t<path>`.
    .map((line) => [line.split('\t')[1], line.split(' ')[0]]),
);

// ---------------------------------------------------------------------------
// Workspace model: package dirs, name → dir, script tables, dependency names.
// ---------------------------------------------------------------------------

/** Globs from pnpm-workspace.yaml's `packages:` list (flat, quoted strings). */
function workspaceGlobs() {
  const lines = readFileSync(
    join(repoRoot, 'pnpm-workspace.yaml'),
    'utf8',
  ).split('\n');
  const globs = [];
  let inPackages = false;
  for (const line of lines) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const m = /^\s+-\s+['"]?([^'"#]+?)['"]?\s*$/.exec(line);
    if (m) globs.push(m[1]);
    else if (line.trim() !== '') inPackages = false;
  }
  return globs;
}

/** Dirs under `dir` (recursive) containing a package.json, build dirs skipped. */
function findPackageDirs(dir, recursive) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  if (entries.some((e) => e.isFile() && e.name === 'package.json')) {
    out.push(dir);
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (
      e.name === 'node_modules' ||
      e.name === 'dist' ||
      e.name.startsWith('.')
    )
      continue;
    const child = join(dir, e.name);
    if (recursive) out.push(...findPackageDirs(child, true));
    else if (existsSync(join(child, 'package.json'))) out.push(child);
  }
  return out;
}

const pkgJsonCache = new Map();
/** Parsed package.json for an absolute package dir, or null. */
function readPkg(dir) {
  if (!pkgJsonCache.has(dir)) {
    let parsed = null;
    try {
      parsed = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    } catch {
      // leave null: caller treats it as "no package here"
    }
    pkgJsonCache.set(dir, parsed);
  }
  return pkgJsonCache.get(dir);
}

const workspaceDirs = new Set([repoRoot]);
for (const glob of workspaceGlobs()) {
  if (glob.endsWith('/**')) {
    for (const d of findPackageDirs(join(repoRoot, glob.slice(0, -3)), true))
      workspaceDirs.add(d);
  } else if (glob.endsWith('/*')) {
    for (const d of findPackageDirs(join(repoRoot, glob.slice(0, -2)), false))
      workspaceDirs.add(d);
  } else if (existsSync(join(repoRoot, glob, 'package.json'))) {
    workspaceDirs.add(join(repoRoot, glob));
  }
}

/** Workspace package name → absolute dir. */
const nameToDir = new Map();
/** Every dependency name declared anywhere in the workspace (for C5 gating). */
const knownDepNames = new Set();
for (const dir of workspaceDirs) {
  const pkg = readPkg(dir);
  if (!pkg) continue;
  if (pkg.name && !nameToDir.has(pkg.name)) nameToDir.set(pkg.name, dir);
  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    for (const dep of Object.keys(pkg[field] ?? {})) knownDepNames.add(dep);
  }
}

/** Nearest workspace package dir at or above `absDir` (repo root at worst). */
function owningPackageDir(absDir) {
  let dir = absDir;
  while (dir.startsWith(repoRoot)) {
    if (readPkg(dir)) return dir;
    if (dir === repoRoot) break;
    dir = dirname(dir);
  }
  return repoRoot;
}

/** All dependency names declared by the package at `dir`. */
function declaredDeps(dir) {
  const pkg = readPkg(dir) ?? {};
  return new Set(
    [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ].flatMap((field) => Object.keys(pkg[field] ?? {})),
  );
}

// ---------------------------------------------------------------------------
// Doc parsing: fenced blocks vs prose, headings, inline-code tokens.
// ---------------------------------------------------------------------------

/**
 * Split a doc into lines annotated with fence state. `fence` is the info
 * string of the enclosing fenced code block ('' for prose lines, 'bash' for
 * lines inside a ```bash block, and so on).
 */
function annotateLines(text) {
  const out = [];
  let fence = '';
  for (const [i, raw] of text.split('\n').entries()) {
    const open = /^```([a-zA-Z]*)\s*$/.exec(raw.trim());
    if (open) {
      fence = fence === '' ? open[1] || 'plain' : '';
      continue;
    }
    out.push({ line: i + 1, text: raw, fence });
  }
  return out;
}

/** Inline-code spans in a prose line. */
function inlineTokens(text) {
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------
// Violations + allowlist.
// ---------------------------------------------------------------------------

const allowlistPath = join(repoRoot, 'scripts/check-harness-docs.allow.json');
const allowlist = existsSync(allowlistPath)
  ? JSON.parse(readFileSync(allowlistPath, 'utf8'))
  : [];
for (const entry of allowlist) {
  if (!entry.file || !entry.token || !entry.reason) {
    stdout.write(
      `check-harness-docs: malformed allowlist entry (file/token/reason all required): ${JSON.stringify(entry)}\n`,
    );
    exit(1);
  }
}

const violations = [];
function report(check, file, line, token, message) {
  if (allowlist.some((a) => a.file === file && a.token === token)) return;
  violations.push({ check, file, line, token, message });
}

// ---------------------------------------------------------------------------
// C1 — CLAUDE.md symlink integrity.
// ---------------------------------------------------------------------------

for (const doc of docFiles) {
  if (!doc.endsWith('AGENTS.md')) continue;
  const claudeRel = join(dirname(doc), 'CLAUDE.md');
  const claudeAbs = join(repoRoot, claudeRel);
  let stat;
  try {
    stat = lstatSync(claudeAbs);
  } catch {
    report(
      'C1',
      claudeRel,
      null,
      'CLAUDE.md',
      `missing CLAUDE.md symlink next to ${doc} (fix: ln -s AGENTS.md ${claudeRel})`,
    );
    continue;
  }
  if (!stat.isSymbolicLink()) {
    report(
      'C1',
      claudeRel,
      null,
      'CLAUDE.md',
      'CLAUDE.md must be a symlink to AGENTS.md, found a regular file',
    );
    continue;
  }
  const target = readlinkSync(claudeAbs);
  if (target !== 'AGENTS.md') {
    report(
      'C1',
      claudeRel,
      null,
      'CLAUDE.md',
      `CLAUDE.md symlink points to ${target}, expected AGENTS.md`,
    );
    continue;
  }
  const mode = trackedClaudeModes.get(claudeRel);
  if (mode !== undefined && mode !== '120000') {
    report(
      'C1',
      claudeRel,
      null,
      'CLAUDE.md',
      `CLAUDE.md tracked with git mode ${mode}, expected symlink mode 120000`,
    );
  }
}

// ---------------------------------------------------------------------------
// C2 — root index completeness.
// ---------------------------------------------------------------------------

const rootDoc = readFileSync(join(repoRoot, 'AGENTS.md'), 'utf8');
const structureSection = (() => {
  const lines = rootDoc.split('\n');
  const start = lines.findIndex((l) => /^##\s+Monorepo structure\s*$/.test(l));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
})();
if (structureSection === null) {
  report(
    'C2',
    'AGENTS.md',
    null,
    'Monorepo structure',
    'root AGENTS.md has no "## Monorepo structure" section',
  );
}

for (const entry of readdirSync(join(repoRoot, 'packages'), {
  withFileTypes: true,
})) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
  const name = entry.name;
  if (
    docFiles.includes(`packages/${name}/AGENTS.md`) &&
    !rootDoc.includes(`packages/${name}/AGENTS.md`)
  ) {
    report(
      'C2',
      'AGENTS.md',
      null,
      `packages/${name}/AGENTS.md`,
      `packages/${name}/AGENTS.md exists but is not referenced in root AGENTS.md`,
    );
  }
  if (
    structureSection !== null &&
    !structureSection.includes(`\`packages/${name}/\``)
  ) {
    report(
      'C2',
      'AGENTS.md',
      null,
      `packages/${name}/`,
      `packages/${name}/ is missing from the "Monorepo structure" section of root AGENTS.md`,
    );
  }
}

// ---------------------------------------------------------------------------
// C3 — command/script validity in ```bash fences.
// ---------------------------------------------------------------------------

// pnpm subcommands / bins that are not workspace scripts.
const PNPM_BIN_ALLOWLIST = new Set([
  'rstest',
  'prettier',
  'install',
  'dlx',
  'exec',
]);

function stripQuotes(token) {
  return token.replace(/^['"]|['"]$/g, '');
}

function scriptsOf(dir) {
  return new Set(Object.keys(readPkg(dir)?.scripts ?? {}));
}

function checkBashLine(doc, docDirAbs, line, text) {
  const noComment = text.replace(/(^|\s)#.*$/, '');
  for (const segment of noComment.split(/&&|\|\||;|\|/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;

    if (tokens[0] === 'pnpm' && tokens[1] === '--filter') {
      const spec = stripQuotes(tokens[2] ?? '');
      const rest = tokens.slice(3);
      if (rest[0] === 'run') rest.shift();
      const script = rest[0];
      // Glob filters fan out; script existence across a glob is meaningless.
      if (/[*?{}]/.test(spec)) continue;
      const pkgDir = spec.startsWith('./')
        ? join(repoRoot, spec)
        : nameToDir.get(spec);
      if (!pkgDir || !readPkg(pkgDir)) {
        report(
          'C3',
          doc,
          line,
          segment.trim(),
          `\`${segment.trim()}\`: no workspace package matches filter "${spec}"`,
        );
        continue;
      }
      if (!script || script.startsWith('-') || script.includes('<')) continue;
      if (!scriptsOf(pkgDir).has(script)) {
        report(
          'C3',
          doc,
          line,
          segment.trim(),
          `\`${segment.trim()}\`: package "${spec}" has no script "${script}"`,
        );
      }
      continue;
    }

    if (tokens[0] === 'npm' && tokens[1] === 'run') {
      const script = stripQuotes(tokens[2] ?? '');
      if (!script || script.startsWith('-') || script.includes('<')) continue;
      const owning = owningPackageDir(docDirAbs);
      if (!scriptsOf(owning).has(script)) {
        report(
          'C3',
          doc,
          line,
          segment.trim(),
          `\`${segment.trim()}\`: no script "${script}" in ${join(owning, 'package.json').slice(repoRoot.length + 1)}`,
        );
      }
      continue;
    }

    if (tokens[0] === 'pnpm' && tokens[1]) {
      const word = stripQuotes(tokens[1]);
      if (!/^[a-z][a-z0-9:._-]*$/.test(word)) continue;
      if (PNPM_BIN_ALLOWLIST.has(word)) continue;
      const owning = owningPackageDir(docDirAbs);
      // In a root doc, a bare `pnpm <word>` must be a root script. In a
      // package doc it may be run from the repo root or from the package dir,
      // so either script table satisfies it.
      const ok =
        scriptsOf(repoRoot).has(word) ||
        (owning !== repoRoot && scriptsOf(owning).has(word));
      if (!ok) {
        report(
          'C3',
          doc,
          line,
          segment.trim(),
          `\`${segment.trim()}\`: "${word}" is neither a root script nor a script of the doc's package`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// C4 — inline-code path existence.
// ---------------------------------------------------------------------------

const PATH_ROOTS = [
  'src/',
  'packages/',
  'e2e/',
  'scripts/',
  'website/',
  '.agents/',
  '.github/',
  'tests/',
  'docs/',
  '../',
];
// Runtime/output paths: never on disk in a clean checkout, skipped by rule.
const PATH_SKIP_PREFIXES = [
  'dist/',
  'coverage/',
  'node_modules/',
  '.rstest-temp',
];

function checkPathToken(doc, docDirAbs, owningDirAbs, line, token) {
  if (/[\s*?{}<>$()`,]/.test(token)) return;
  if (token.includes('://') || token.includes('...')) return;
  if (token.startsWith('@')) return; // npm name, not a path
  if (!token.includes('/')) return;
  if (!PATH_ROOTS.some((p) => token.startsWith(p))) return;
  // Skip generated-output references anywhere in the path (e.g. a package's
  // `dist/index.js` or `packages/core/dist/...`).
  const bare = token.replace(/^(\.\.\/)+|^\.\//, '');
  if (
    PATH_SKIP_PREFIXES.some((p) => bare.startsWith(p) || bare.includes(`/${p}`))
  )
    return;
  // `file.ts:12`, `file.ts:83-133`, `file.ts:163,178` — validate the path,
  // not the line anchor.
  const path = token
    .replace(/:\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/, '')
    .replace(/\/$/, '');
  // Nested docs (e.g. packages/core/src/pool/AGENTS.md) conventionally write
  // package-relative paths like `src/core/runnerEventSink.ts`, so the owning
  // package dir is a resolution base between the doc's dir and the repo root.
  if (existsSync(resolve(docDirAbs, path))) return;
  if (existsSync(resolve(owningDirAbs, path))) return;
  if (existsSync(resolve(repoRoot, path))) return;
  report(
    'C4',
    doc,
    line,
    token,
    `path \`${token}\` resolves against neither ${dirname(doc) || '.'}/ nor its package root nor the repo root`,
  );
}

// ---------------------------------------------------------------------------
// C5 — dependency-name claims in Dependencies / Tech stack sections.
// ---------------------------------------------------------------------------

const DEP_SECTION_RE = /^(#{1,6})\s+(?:Dependencies|Tech stack)\s*$/i;
const NPM_NAME_RE = /^[a-z0-9~][a-z0-9._-]*$/;

function checkDepToken(doc, pkgDir, line, token) {
  let name = token;
  if (token.startsWith('@')) {
    // `@scope/name` or a subpath entrypoint like `@scope/name/internal/x`.
    const parts = token.split('/');
    if (parts.length < 2 || !NPM_NAME_RE.test(parts[1])) return;
    name = `${parts[0]}/${parts[1]}`;
  } else {
    if (token.includes('/') || !NPM_NAME_RE.test(token)) return;
    // Bare single words without a hyphen are usually prose; only treat them as
    // dependency claims when the word is a dependency somewhere in the
    // workspace (`playwright`, `antd`, ...).
    if (!token.includes('-') && !knownDepNames.has(token)) return;
  }
  if (!declaredDeps(pkgDir).has(name)) {
    report(
      'C5',
      doc,
      line,
      token,
      `\`${token}\` is claimed as a dependency but "${name}" is not in ${join(pkgDir, 'package.json').slice(repoRoot.length + 1)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Scan every doc for C3/C4/C5.
// ---------------------------------------------------------------------------

for (const doc of docFiles) {
  const docDirAbs = join(repoRoot, dirname(doc));
  const lines = annotateLines(readFileSync(join(repoRoot, doc), 'utf8'));
  const owning = owningPackageDir(docDirAbs);

  let depSectionLevel = 0; // heading level of the open Dependencies section
  for (const { line, text, fence } of lines) {
    if (fence === 'bash') {
      checkBashLine(doc, docDirAbs, line, text);
      continue;
    }
    if (fence !== '') continue; // other fenced code is out of scope

    const heading = /^(#{1,6})\s/.exec(text);
    if (heading) {
      depSectionLevel = DEP_SECTION_RE.test(text.trim())
        ? heading[1].length
        : depSectionLevel && heading[1].length <= depSectionLevel
          ? 0
          : depSectionLevel;
    }

    for (const token of inlineTokens(text)) {
      checkPathToken(doc, docDirAbs, owning, line, token);
      // C5 only applies to package docs (root has no dependency sections).
      if (depSectionLevel > 0 && owning !== repoRoot) {
        checkDepToken(doc, owning, line, token);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Output.
// ---------------------------------------------------------------------------

violations.sort(
  (a, b) =>
    a.check.localeCompare(b.check) ||
    a.file.localeCompare(b.file) ||
    (a.line ?? 0) - (b.line ?? 0),
);

if (asJson) {
  stdout.write(`${JSON.stringify(violations, null, 2)}\n`);
  exit(violations.length > 0 ? 1 : 0);
}

for (const v of violations) {
  const loc = v.line === null ? v.file : `${v.file}:${v.line}`;
  stdout.write(`${v.check} ${loc}: ${v.message}\n`);
}
exit(violations.length > 0 ? 1 : 0);
