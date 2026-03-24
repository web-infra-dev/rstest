#!/usr/bin/env node
/**
 * Validates that AGENTS.md stays consistent with the actual codebase structure.
 *
 * Checks:
 * 1. All directories in "Monorepo structure" exist on disk
 * 2. All sub-package AGENTS.md references point to existing files
 * 3. Every package under packages/ is documented in AGENTS.md
 * 4. Root pnpm scripts referenced in "Commands" exist in package.json
 * 5. Top-level directories (e2e, examples, website, scripts) exist
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const AGENTS_MD_PATH = path.join(ROOT, 'AGENTS.md');

const errors = [];

function fail(msg) {
  errors.push(msg);
  console.error(`  FAIL: ${msg}`);
}

function pass(msg) {
  console.log(`  OK: ${msg}`);
}

// Read AGENTS.md
const agentsMd = fs.readFileSync(AGENTS_MD_PATH, 'utf-8');

// --- 1. Validate "Monorepo structure" directory references ---
console.log('\n[1] Checking monorepo structure directory references...');

const structurePattern = /^- `([^`]+\/)`/gm;
const structureDirs = [];
for (const m of agentsMd.matchAll(structurePattern)) {
  structureDirs.push(m[1]);
}

for (const dir of structureDirs) {
  const fullPath = path.join(ROOT, dir);
  if (fs.existsSync(fullPath)) {
    pass(`Directory "${dir}" exists`);
  } else {
    fail(`Directory "${dir}" referenced in Monorepo structure does not exist`);
  }
}

// --- 2. Validate sub-package AGENTS.md references ---
console.log('\n[2] Checking sub-package AGENTS.md references...');

const agentsMdRefPattern = /@([^\s]+AGENTS\.md)/g;
const referencedAgentsMds = [];

for (const m of agentsMd.matchAll(agentsMdRefPattern)) {
  referencedAgentsMds.push(m[1]);
}

for (const ref of referencedAgentsMds) {
  const fullPath = path.join(ROOT, ref);
  if (fs.existsSync(fullPath)) {
    pass(`Sub-package AGENTS.md "${ref}" exists`);
  } else {
    fail(`Referenced sub-package AGENTS.md "${ref}" does not exist`);
  }
}

// --- 3. Validate all packages/ dirs are documented ---
console.log('\n[3] Checking all packages/ directories are documented...');

const packagesDir = path.join(ROOT, 'packages');
const actualPackages = fs.readdirSync(packagesDir).filter((entry) => {
  return fs.statSync(path.join(packagesDir, entry)).isDirectory();
});

for (const pkg of actualPackages) {
  const dirRef = `packages/${pkg}/`;
  if (agentsMd.includes(dirRef)) {
    pass(`Package "${pkg}" is documented in AGENTS.md`);
  } else {
    fail(
      `Package "packages/${pkg}/" exists on disk but is not documented in AGENTS.md monorepo structure`,
    );
  }
}

// --- 4. Validate root pnpm scripts referenced in Commands section ---
console.log('\n[4] Checking referenced root pnpm scripts...');

const pkgJsonPath = path.join(ROOT, 'package.json');
const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
const availableScripts = Object.keys(pkgJson.scripts || {});

// Extract "pnpm <script>" commands from the "# Root commands" subsection only.
// We only validate root-level pnpm scripts (not --filter, not direct tool
// invocations like "pnpm biome" under "File-scoped").
const commandsSection = agentsMd.match(
  /## Commands\s*\n```bash\n([\s\S]*?)```/,
);
if (commandsSection) {
  const commandLines = commandsSection[1].split('\n');
  const rootScriptPattern = /^pnpm (\w[\w:-]*)(?:\s|$)/;
  const checkedScripts = new Set();
  let inRootSection = false;

  for (const line of commandLines) {
    const trimmed = line.trim();

    // Track which sub-section we are in
    if (trimmed.startsWith('# Root commands')) {
      inRootSection = true;
      continue;
    }
    if (trimmed.startsWith('#') && !trimmed.startsWith('# Root')) {
      inRootSection = false;
      continue;
    }
    if (!inRootSection || !trimmed) continue;

    const scriptMatch = trimmed.match(rootScriptPattern);
    if (scriptMatch) {
      const scriptName = scriptMatch[1];
      // Skip built-in pnpm commands
      const builtInCommands = [
        'install',
        'run',
        'exec',
        'add',
        'remove',
        'update',
        'fetch',
        'dedupe',
      ];
      if (builtInCommands.includes(scriptName)) continue;
      if (checkedScripts.has(scriptName)) continue;
      checkedScripts.add(scriptName);

      if (availableScripts.includes(scriptName)) {
        pass(`Root script "pnpm ${scriptName}" exists in package.json`);
      } else {
        fail(
          `Root script "pnpm ${scriptName}" is referenced in Commands but not found in package.json`,
        );
      }
    }
  }
} else {
  fail('Could not find "## Commands" section with a bash code block');
}

// --- 5. Validate top-level directories ---
console.log('\n[5] Checking top-level directories...');

const topLevelDirs = ['e2e', 'examples', 'website', 'scripts'];
for (const dir of topLevelDirs) {
  if (agentsMd.includes(`\`${dir}/\``) || agentsMd.includes(`\`${dir}\``)) {
    const fullPath = path.join(ROOT, dir);
    if (fs.existsSync(fullPath)) {
      pass(`Top-level directory "${dir}" exists`);
    } else {
      fail(
        `Top-level directory "${dir}" referenced in AGENTS.md does not exist`,
      );
    }
  }
}

// --- 6. Validate sub-package AGENTS.md files exist for every package ---
console.log('\n[6] Checking every package has an AGENTS.md reference...');

for (const pkg of actualPackages) {
  const agentsMdFile = path.join(packagesDir, pkg, 'AGENTS.md');
  const refPattern = new RegExp(`@?packages/${pkg}/AGENTS\\.md`);

  if (fs.existsSync(agentsMdFile)) {
    if (refPattern.test(agentsMd)) {
      pass(`Package "${pkg}" AGENTS.md is referenced in root AGENTS.md`);
    } else {
      fail(
        `Package "${pkg}" has an AGENTS.md but it is not referenced in root AGENTS.md sub-package instructions`,
      );
    }
  }
}

// --- Summary ---
console.log(`\n${'='.repeat(60)}`);
if (errors.length > 0) {
  console.error(`\nFAILED: ${errors.length} issue(s) found:\n`);
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
} else {
  console.log('\nPASSED: AGENTS.md is consistent with the codebase.');
  process.exit(0);
}
