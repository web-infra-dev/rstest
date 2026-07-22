#!/usr/bin/env node

// Deterministic drift checker for the agent-harness docs (AGENTS.md files and
// .agents/skills/*/SKILL.md). Modeled on
// .agents/skills/api-doc-sync/scripts/check-type-blocks.mjs: per-violation
// messages, non-zero exit on drift.
//
// Markdown and shell are parsed by `marked` and `shell-quote` (both zero
// dependency) rather than by regex. Hand-rolled fence/quote matching fails
// silently — an info string like ```bash title="x" used to leave the opening
// fence unrecognized, so the *closing* fence opened a block and the rest of the
// doc went unchecked with no diagnostic. Regex is kept only where the task is
// classification, not parsing (is this token a path? an npm name?).
//
// Checks (all deterministic, no prose/semantic judgment):
//   C1 — every AGENTS.md has a sibling CLAUDE.md that is a symlink to AGENTS.md
//        (git mode 120000 when tracked).
//   C2 — root AGENTS.md references every packages/*/AGENTS.md by path, and its
//        "Monorepo structure" section lists every direct child of packages/.
//   C3 — commands in ```bash fences (`shell-quote` splits words, strips quotes,
//        and drops comments): `pnpm --filter <pkg> <script>` scripts
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
// Non-goals: no prose/behavioral checking, no signature checking (api-doc-sync
// owns that), no auto-fix.

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
import { Lexer } from 'marked';
import { parse as parseShellWords } from 'shell-quote';

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
// Doc parsing: marked's lexer, flattened into positioned events.
// ---------------------------------------------------------------------------

/**
 * Flatten a doc into ordered events: `heading` (section state for C2/C5),
 * `command` (one per line of a ```bash fence, for C3) and `codespan` (inline
 * code outside code blocks, for C4/C5).
 *
 * marked owns the grammar, so info strings, longer fences and inline code in
 * tables, lists and blockquotes are seen the way a renderer sees them. Line
 * numbers come from a cursor that only moves forward: container tokens move it
 * to their start so their children stay findable, leaf tokens consume their
 * `raw`. A `raw` that is not a contiguous substring of the source (a wrapped
 * blockquote paragraph, say) leaves the cursor where it is, which costs at
 * worst an imprecise line number in one message.
 */
function docEvents(src) {
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\n') lineStarts.push(i + 1);
  }
  const lineOf = (offset) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const events = [];
  let cursor = 0;
  /** Start offset of `raw`, cursor left at that start (container tokens). */
  const enter = (raw) => {
    const idx = src.indexOf(raw, cursor);
    if (idx === -1) return cursor;
    cursor = idx;
    return idx;
  };
  /** Start offset of `raw`, cursor moved past it (leaf tokens). */
  const take = (raw) => {
    const idx = src.indexOf(raw, cursor);
    if (idx === -1) return cursor;
    cursor = idx + raw.length;
    return idx;
  };

  const walk = (tokens) => {
    for (const token of tokens ?? []) {
      if (token.type === 'code') {
        const startLine = lineOf(take(token.raw));
        // CommonMark: the language is the first word of the info string.
        if ((token.lang ?? '').trim().split(/\s+/)[0] !== 'bash') continue;
        for (const [i, text] of token.text.split('\n').entries()) {
          // +1: `token.text` starts on the line after the opening fence.
          events.push({ kind: 'command', line: startLine + 1 + i, text });
        }
        continue;
      }
      if (token.type === 'codespan') {
        const line = lineOf(take(token.raw));
        events.push({ kind: 'codespan', line, text: token.text });
        continue;
      }
      const start = token.raw === undefined ? cursor : enter(token.raw);
      if (token.type === 'heading') {
        events.push({
          kind: 'heading',
          line: lineOf(start),
          depth: token.depth,
          text: token.text,
        });
      }
      walk(token.tokens);
      walk(token.items);
      if (token.header) walk(token.header.flatMap((cell) => cell.tokens ?? []));
      if (token.rows) {
        walk(token.rows.flat().flatMap((cell) => cell.tokens ?? []));
      }
    }
  };
  walk(Lexer.lex(src));
  return events;
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
const rootEvents = docEvents(rootDoc);
const structureSection = (() => {
  const headings = rootEvents.filter((e) => e.kind === 'heading');
  const startAt = headings.findIndex(
    (h) => h.depth === 2 && h.text === 'Monorepo structure',
  );
  if (startAt === -1) return null;
  const end = headings.slice(startAt + 1).find((h) => h.depth <= 2);
  const lines = rootDoc.split('\n');
  return lines
    .slice(headings[startAt].line - 1, end ? end.line - 1 : lines.length)
    .join('\n');
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

/** Operators that end one command and start the next. */
const COMMAND_SEPARATORS = new Set(['&&', '||', ';', '|', '&']);

function scriptsOf(dir) {
  return new Set(Object.keys(readPkg(dir)?.scripts ?? {}));
}

/**
 * Words of each command on a shell line. `shell-quote` resolves quoting, so a
 * `#` or `|` inside a quoted argument stays part of that argument instead of
 * truncating the line. Everything after a real comment is dropped; redirection
 * operators contribute no words.
 */
function commandsOf(text) {
  const commands = [[]];
  for (const word of parseShellWords(text)) {
    if (typeof word === 'string') {
      commands.at(-1).push(word);
      continue;
    }
    if (word.comment !== undefined) break;
    if (word.op === 'glob') commands.at(-1).push(word.pattern);
    else if (COMMAND_SEPARATORS.has(word.op)) commands.push([]);
  }
  return commands.filter((words) => words.length > 0);
}

function checkBashLine(doc, docDirAbs, line, text) {
  for (const words of commandsOf(text)) {
    const command = words.join(' ');

    if (words[0] === 'pnpm' && words[1] === '--filter') {
      const spec = words[2] ?? '';
      const rest = words.slice(3);
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
          command,
          `\`${command}\`: no workspace package matches filter "${spec}"`,
        );
        continue;
      }
      if (!script || script.startsWith('-') || script.includes('<')) continue;
      if (!scriptsOf(pkgDir).has(script)) {
        report(
          'C3',
          doc,
          line,
          command,
          `\`${command}\`: package "${spec}" has no script "${script}"`,
        );
      }
      continue;
    }

    if (words[0] === 'npm' && words[1] === 'run') {
      const script = words[2] ?? '';
      if (!script || script.startsWith('-') || script.includes('<')) continue;
      const owning = owningPackageDir(docDirAbs);
      if (!scriptsOf(owning).has(script)) {
        report(
          'C3',
          doc,
          line,
          command,
          `\`${command}\`: no script "${script}" in ${join(owning, 'package.json').slice(repoRoot.length + 1)}`,
        );
      }
      continue;
    }

    if (words[0] === 'pnpm' && words[1]) {
      const word = words[1];
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
          command,
          `\`${command}\`: "${word}" is neither a root script nor a script of the doc's package`,
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

const DEP_SECTION_RE = /^(?:Dependencies|Tech stack)$/i;
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
  const owning = owningPackageDir(docDirAbs);
  const events = docEvents(readFileSync(join(repoRoot, doc), 'utf8'));

  let depSectionLevel = 0; // heading level of the open Dependencies section
  for (const event of events) {
    if (event.kind === 'command') {
      checkBashLine(doc, docDirAbs, event.line, event.text);
      continue;
    }

    if (event.kind === 'heading') {
      depSectionLevel = DEP_SECTION_RE.test(event.text)
        ? event.depth
        : depSectionLevel && event.depth <= depSectionLevel
          ? 0
          : depSectionLevel;
      continue;
    }

    checkPathToken(doc, docDirAbs, owning, event.line, event.text);
    // C5 only applies to package docs (root has no dependency sections).
    if (depSectionLevel > 0 && owning !== repoRoot) {
      checkDepToken(doc, owning, event.line, event.text);
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
