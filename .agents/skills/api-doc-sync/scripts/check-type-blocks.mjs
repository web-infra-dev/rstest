#!/usr/bin/env node

// Extract every `**Type:**` / `**类型：**` signature block from the API doc
// pages and check that the English and Chinese pages declare structurally
// identical signatures — only the label and translated `//` comments may
// differ. This is the DETERMINISTIC half of the `api-doc-sync` skill: en/zh
// parity is a hard rule, so it is enforced here rather than left to judgement.
// The semantic "does this signature match the exported type" half is done by
// the agent with `tsc` (see SKILL.md).
//
// Usage:
//   node check-type-blocks.mjs [docsRoot]
//     docsRoot defaults to website/docs. Scans the union of <root>/en/api and
//     <root>/zh/api pages so a one-sided edit (a zh-only page, or a `**类型：**`
//     block added where the en page has none) cannot slip past the guard.
//   node check-type-blocks.mjs --json [docsRoot]
//     Emit machine-readable JSON instead of the human report.
//
// Exit code is 1 when any en/zh signature mismatch (or missing counterpart)
// is found, so the script doubles as a CI/pre-push guard.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { argv, cwd, exit, stdout } from 'node:process';
import { join, relative } from 'node:path';

const args = argv.slice(2);
const asJson = args.includes('--json');
const docsRoot = args.find((a) => !a.startsWith('--')) ?? 'website/docs';

const LABEL_RE = /^\s*-\s*\*\*(?:Type:|类型：)\*\*\s*(.*)$/;

/** Recursively list `.mdx` files under `dir`. */
function listMdx(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listMdx(full));
    } else if (entry.endsWith('.mdx')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Parse `**Type:**` blocks from a doc file. Each block is anchored to the
 * nearest preceding heading so en/zh entries can be compared position-free.
 * Supports the inline form (`- **Type:** \`...\``), the fenced form
 * (`- **Type:**` followed by a ```ts code block), and the list form
 * (`- **Type:**` followed by `-` bullet overloads).
 */
function parseTypeBlocks(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const blocks = [];
  // Count every `**Type:**` label so the caller can assert each one produced a
  // block — a label with no block means a signature form the parser does not
  // recognize, which must fail loudly instead of being silently under-counted.
  let labels = 0;
  let heading = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const headingMatch = /^#{1,6}\s+(.*)$/.exec(line);
    if (headingMatch) {
      heading = headingMatch[1].trim();
      continue;
    }

    const labelMatch = LABEL_RE.exec(line);
    if (!labelMatch) {
      continue;
    }
    labels++;

    const inline = labelMatch[1].trim();
    if (inline) {
      // Inline form: signature lives in backticks on the same line.
      blocks.push({ heading, signature: stripFence(inline) });
      continue;
    }

    // Label alone on the line: the signature follows as either a fenced code
    // block or a bullet list of overloads. Skip blank lines, then dispatch.
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') {
      j++;
    }
    if (j < lines.length && lines[j].trim().startsWith('```')) {
      // Fenced form: collect the next ``` block.
      const body = [];
      j++;
      while (j < lines.length && !lines[j].trim().startsWith('```')) {
        body.push(lines[j]);
        j++;
      }
      blocks.push({ heading, signature: body.join('\n').trim() });
      i = j;
    } else if (j < lines.length && /^\s*-\s/.test(lines[j])) {
      // List form: contiguous `-` bullet overloads, e.g.
      //   - **Type:**
      //     - `(a: string) => void`
      //     - `(a: string, b: number) => void`
      const body = [];
      while (j < lines.length && /^\s*-\s/.test(lines[j])) {
        body.push(lines[j].trim());
        j++;
      }
      blocks.push({ heading, signature: body.join('\n') });
      i = j - 1;
    }
  }

  return { blocks, labels };
}

/** Drop surrounding backticks from an inline signature. */
function stripFence(text) {
  const m = /^`([\s\S]*)`$/.exec(text);
  return (m ? m[1] : text).trim();
}

/** Relative `.mdx` paths under `root`; `[]` if the root does not exist. */
function listRel(root) {
  try {
    return listMdx(root).map((f) => relative(root, f));
  } catch {
    return [];
  }
}

/** Parse a page; returns `{ blocks, labels }`, or `null` when the file is missing. */
function tryParse(file) {
  try {
    return parseTypeBlocks(file);
  } catch {
    return null;
  }
}

/**
 * Normalize a heading for en/zh comparison. Headings are API names that should
 * be identical across locales, but legitimately differ in punctuation width and
 * spacing (`expect.element (Browser Mode)` vs `expect.element（Browser Mode）`),
 * so fold fullwidth forms via NFKC and drop whitespace before comparing.
 */
function normalizeHeading(heading) {
  return heading.normalize('NFKC').replace(/\s+/g, '');
}

/** Exit with a configuration error if `root` is not an existing directory. */
function assertRoot(root) {
  try {
    if (statSync(root).isDirectory()) {
      return;
    }
  } catch {
    // fall through to the error below
  }
  stdout.write(
    `✖ docs root not found: ${relative(cwd(), root) || root}\n` +
      '  Pass the correct docsRoot (defaults to website/docs); run from the repo root.\n',
  );
  exit(1);
}

/**
 * Normalize a signature for en/zh comparison. Inline comments are prose and
 * are legitimately translated (`// default: 1000` vs `// 默认: 1000`), so they
 * are stripped before comparing — only the structural type must be identical.
 */
function normalizeForCompare(signature) {
  return signature
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/\/\/[^\n]*/g, '') // line comments
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')
    .join('\n');
}

const enRoot = join(docsRoot, 'en', 'api');
const zhRoot = join(docsRoot, 'zh', 'api');

// A missing root means a bad docsRoot or wrong cwd — fail loudly rather than
// scanning an empty union and reporting a vacuous "in sync" that disables the
// gate it advertises.
assertRoot(enRoot);
assertRoot(zhRoot);

const findings = [];
let pagesWithTypes = 0;
let blockCount = 0;

// Iterate the union of en/zh relative paths: anchoring on en alone would let a
// zh-only page, or a zh block added where the en page has none, slip past.
const pages = [...new Set([...listRel(enRoot), ...listRel(zhRoot)])].sort();

for (const rel of pages) {
  const enFile = join(enRoot, rel);
  const zhFile = join(zhRoot, rel);

  const en = tryParse(enFile);
  const zh = tryParse(zhFile);

  // No Type labels on either side → nothing to compare.
  if ((en?.labels ?? 0) === 0 && (zh?.labels ?? 0) === 0) {
    continue;
  }

  if (en === null) {
    findings.push({ page: rel, kind: 'missing-en-page', detail: enFile });
    continue;
  }
  if (zh === null) {
    findings.push({ page: rel, kind: 'missing-zh-page', detail: zhFile });
    continue;
  }

  // Coverage self-check: every `**Type:**` label must have produced a block. A
  // shortfall means a signature form the parser does not recognize was silently
  // dropped — fail loudly and skip the (now unreliable) comparison for this page.
  let coverageGap = false;
  for (const [loc, parsed] of [
    ['en', en],
    ['zh', zh],
  ]) {
    if (parsed.blocks.length !== parsed.labels) {
      coverageGap = true;
      findings.push({
        page: rel,
        kind: 'parser-coverage',
        detail: `${loc}: ${parsed.labels} **Type:** label(s) but parsed ${parsed.blocks.length} block(s) — an unrecognized Type block form was dropped`,
      });
    }
  }
  if (coverageGap) {
    continue;
  }

  const enBlocks = en.blocks;
  const zhBlocks = zh.blocks;

  pagesWithTypes++;
  blockCount += enBlocks.length;

  if (enBlocks.length !== zhBlocks.length) {
    findings.push({
      page: rel,
      kind: 'count-mismatch',
      detail: `en has ${enBlocks.length} Type block(s), zh has ${zhBlocks.length}`,
    });
    continue;
  }

  for (let k = 0; k < enBlocks.length; k++) {
    const en = enBlocks[k];
    const zh = zhBlocks[k];
    if (normalizeHeading(en.heading) !== normalizeHeading(zh.heading)) {
      // Blocks are paired by position; divergent headings mean a block moved or
      // a section was renamed on one side, so the locales no longer document the
      // same APIs even when the signatures still line up.
      findings.push({
        page: rel,
        kind: 'heading-mismatch',
        detail: { en: en.heading, zh: zh.heading },
      });
      continue;
    }
    if (
      normalizeForCompare(en.signature) !== normalizeForCompare(zh.signature)
    ) {
      findings.push({
        page: rel,
        kind: 'signature-mismatch',
        heading: en.heading,
        detail: { en: en.signature, zh: zh.signature },
      });
    }
  }
}

if (asJson) {
  stdout.write(
    `${JSON.stringify({ pagesWithTypes, blockCount, findings }, null, 2)}\n`,
  );
  exit(findings.length > 0 ? 1 : 0);
}

stdout.write(
  `Scanned ${blockCount} **Type:** block(s) across ${pagesWithTypes} en/zh API page(s) in ${relative(cwd(), docsRoot) || docsRoot}.\n`,
);

if (findings.length === 0) {
  stdout.write('✔ en/zh type signatures are in sync.\n');
  exit(0);
}

stdout.write(`\n✖ ${findings.length} en/zh drift issue(s):\n\n`);
for (const f of findings) {
  if (f.kind === 'signature-mismatch') {
    stdout.write(`  [${f.page}] under "${f.heading}":\n`);
    stdout.write(`    en: ${f.detail.en.replace(/\n/g, '\\n')}\n`);
    stdout.write(`    zh: ${f.detail.zh.replace(/\n/g, '\\n')}\n`);
  } else if (f.kind === 'heading-mismatch') {
    stdout.write(`  [${f.page}] heading-mismatch:\n`);
    stdout.write(`    en: ${f.detail.en}\n`);
    stdout.write(`    zh: ${f.detail.zh}\n`);
  } else {
    stdout.write(`  [${f.page}] ${f.kind}: ${f.detail}\n`);
  }
}
exit(1);
