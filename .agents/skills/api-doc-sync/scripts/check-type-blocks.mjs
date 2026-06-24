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
//     docsRoot defaults to website/docs. Scans <root>/en/api and pairs each
//     page with its <root>/zh/api counterpart.
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
 * Supports both the inline form (`- **Type:** \`...\``) and the fenced form
 * (`- **Type:**` followed by a ```ts code block).
 */
function parseTypeBlocks(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const blocks = [];
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

    const inline = labelMatch[1].trim();
    if (inline) {
      // Inline form: signature lives in backticks on the same line.
      blocks.push({ heading, signature: stripFence(inline) });
      continue;
    }

    // Fenced form: skip blank lines, then collect the next ``` block.
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') {
      j++;
    }
    if (j < lines.length && lines[j].trim().startsWith('```')) {
      const body = [];
      j++;
      while (j < lines.length && !lines[j].trim().startsWith('```')) {
        body.push(lines[j]);
        j++;
      }
      blocks.push({ heading, signature: body.join('\n').trim() });
      i = j;
    }
  }

  return blocks;
}

/** Drop surrounding backticks from an inline signature. */
function stripFence(text) {
  const m = /^`([\s\S]*)`$/.exec(text);
  return (m ? m[1] : text).trim();
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

const findings = [];
let pagesWithTypes = 0;
let blockCount = 0;

for (const enFile of listMdx(enRoot)) {
  const rel = relative(enRoot, enFile);
  const zhFile = join(zhRoot, rel);

  const enBlocks = parseTypeBlocks(enFile);
  if (enBlocks.length === 0) {
    continue;
  }
  pagesWithTypes++;
  blockCount += enBlocks.length;

  let zhBlocks;
  try {
    zhBlocks = parseTypeBlocks(zhFile);
  } catch {
    findings.push({ page: rel, kind: 'missing-zh-page', detail: zhFile });
    continue;
  }

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
  `Scanned ${blockCount} **Type:** block(s) across ${pagesWithTypes} API page(s) in ${relative(cwd(), enRoot) || enRoot}.\n`,
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
  } else {
    stdout.write(`  [${f.page}] ${f.kind}: ${f.detail}\n`);
  }
}
exit(1);
