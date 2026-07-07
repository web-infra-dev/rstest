// Enforce that every package released together shares one version. The release
// train is defined by bump.config.mts (`bumpp` bumps every packages/* except
// the negated globs), so this check mirrors that set: all packages/* must share
// the same `version`, with the same exclusions.
//
// Plain .mjs (not .mts) so it runs on the full supported Node range, including
// Node 20 which cannot execute TypeScript directly.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = join(rootDir, 'packages');

// Packages intentionally excluded from the unified release version. Keep in sync
// with the `!packages/*` negations in bump.config.mts. browser-ui is a private,
// prebuilt UI container that is not part of the versioned release train.
const EXCLUDED = new Set(['browser-ui']);

const packages = [];
for (const name of readdirSync(packagesDir)) {
  if (EXCLUDED.has(name)) {
    continue;
  }

  let pkg;
  try {
    pkg = JSON.parse(
      readFileSync(join(packagesDir, name, 'package.json'), 'utf8'),
    );
  } catch {
    // Not a package directory (missing/invalid package.json).
    continue;
  }

  if (pkg.version) {
    packages.push({ name: pkg.name ?? name, version: pkg.version });
  }
}

const versions = new Set(packages.map((pkg) => pkg.version));

if (versions.size > 1) {
  const detail = packages
    .map((pkg) => `  ${pkg.name}: ${pkg.version}`)
    .join('\n');
  console.error(
    `✗ Package versions under packages/ are not unified:\n${detail}\n\n` +
      'All packages in the release train must share one version. ' +
      'See bump.config.mts.',
  );
  process.exit(1);
}

console.log(
  `✓ All ${packages.length} packages under packages/ share version ${[...versions][0]}`,
);
