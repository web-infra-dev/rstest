import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REF = process.env.AGENT_SKILL_REF || 'main';
const SKILL_PATH = 'skills/migrate-to-rstest/SKILL.md';
const SKILL_URL = `https://raw.githubusercontent.com/rstackjs/agent-skills/${REF}/${SKILL_PATH}`;
const REFERENCES_BASE = `https://raw.githubusercontent.com/rstackjs/agent-skills/${REF}/skills/migrate-to-rstest/`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED_DIR = resolve(__dirname, '../docs/en/shared');
const TEMPLATE = resolve(SHARED_DIR, 'agent-migrate.template.md');
const OUTPUT = resolve(SHARED_DIR, 'agent-migrate.md');
const PLACEHOLDER = '<!-- @inline-skill: migrate-to-rstest -->';

async function fetchSkill(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

function processSkill(skill) {
  let body = skill;

  // Strip YAML frontmatter — Rspress would otherwise parse it as page metadata.
  body = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, '');

  // Rewrite relative references/*.md paths to absolute remote URLs so the
  // inlined skill can still follow its sub-references without being bundled.
  body = body.replace(
    /\breferences\/([\w-]+\.md)\b/g,
    (_, rest) => `${REFERENCES_BASE}references/${rest}`,
  );

  return body.trimEnd();
}

async function main() {
  const template = await readFile(TEMPLATE, 'utf8');
  if (!template.includes(PLACEHOLDER)) {
    throw new Error(`Placeholder ${PLACEHOLDER} not found in ${TEMPLATE}`);
  }

  const skill = await fetchSkill(SKILL_URL);
  const processed = processSkill(skill);
  const rendered = template.replace(PLACEHOLDER, processed);

  await writeFile(OUTPUT, rendered);
  console.log(`[build-agent-install] Wrote ${OUTPUT} (ref: ${REF})`);
}

main().catch((err) => {
  console.error('[build-agent-install]', err.message);
  process.exit(1);
});
