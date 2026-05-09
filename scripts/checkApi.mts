#!/usr/bin/env node
/**
 * Drives api-extractor over every public package's d.ts entry. All
 * configuration is synthesized in TS so individual packages don't carry
 * api-extractor.json / tsdoc.json stubs — adding a new public package is one
 * line in the `entries` array below.
 *
 * Set UPDATE_API=1 to write fresh `etc/*.api.md` baselines instead of failing
 * on drift.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Extractor,
  ExtractorConfig,
  type ExtractorResult,
  type IConfigFile,
} from '@microsoft/api-extractor';
import { TSDocConfigFile } from '@microsoft/tsdoc-config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const sharedConfig: IConfigFile = JSON.parse(
  readFileSync(join(__dirname, 'api-extractor.shared.json'), 'utf8'),
);
const tsdocConfigFile = TSDocConfigFile.loadFile(
  join(__dirname, 'tsdoc.shared.json'),
);

// Workaround: rslib's d.ts emit drops the `declare global { namespace jest }`
// block from @vitest/expect, leaving inlined `jest.Matchers` references
// unresolvable. The shim provides a minimal declaration consumed by
// api-extractor only.
const JEST_SHIM = '../../scripts/api-extractor-shims/jest-namespace.d.ts';

const tsconfigSrcDistShim = {
  extends: '@rstest/tsconfig/base',
  compilerOptions: {
    outDir: './dist',
    rootDir: './src',
    types: ['node'],
    skipLibCheck: true,
  },
  include: ['./src', './dist/**/*.d.ts', JEST_SHIM],
};

const tsconfigDistOnly = {
  extends: '@rstest/tsconfig/base',
  compilerOptions: {
    outDir: './dist',
    rootDir: './dist',
    types: ['node'],
    skipLibCheck: true,
  },
  include: ['./dist/**/*.d.ts'],
  exclude: [],
};

interface Entry {
  /** Package directory name under `packages/`. */
  pkg: string;
  /** d.ts basename inside dist/, defaults to `index`. */
  entry?: string;
  /** Report file basename, defaults to package's unscoped name. */
  reportName?: string;
  /** Optional tsconfig override for the api-extractor compiler. */
  tsconfig?: object;
}

const entries: Entry[] = [
  { pkg: 'core', tsconfig: tsconfigSrcDistShim },
  {
    pkg: 'core',
    entry: 'browser',
    reportName: 'core-browser',
    tsconfig: tsconfigSrcDistShim,
  },
  { pkg: 'browser', entry: 'browser', tsconfig: tsconfigDistOnly },
  { pkg: 'browser-react' },
  { pkg: 'coverage-istanbul' },
  { pkg: 'adapter-rsbuild' },
  { pkg: 'adapter-rslib' },
  { pkg: 'adapter-rspack' },
];

assertEntriesCoverPublicPackages();

const isUpdate = process.env.UPDATE_API === '1';

function buildConfig(entry: Entry, pkgDir: string): IConfigFile {
  const dts = entry.entry ?? 'index';
  const config: IConfigFile = {
    ...sharedConfig,
    projectFolder: pkgDir,
    mainEntryPointFilePath: `<projectFolder>/dist/${dts}.d.ts`,
  };
  if (entry.reportName) {
    config.apiReport = {
      ...sharedConfig.apiReport,
      reportFileName: `${entry.reportName}.api.md`,
    };
    config.docModel = {
      ...sharedConfig.docModel,
      apiJsonFilePath: `<projectFolder>/etc/${entry.reportName}.api.json`,
    };
  }
  config.compiler = entry.tsconfig
    ? { overrideTsconfig: entry.tsconfig }
    : { tsconfigFilePath: '<projectFolder>/tsconfig.json' };
  return config;
}

let failures = 0;

for (const entry of entries) {
  const pkgDir = join(repoRoot, 'packages', entry.pkg);
  const label = `packages/${entry.pkg}${entry.reportName ? ` (${entry.reportName})` : ''}`;
  const cfg = ExtractorConfig.prepare({
    configObject: buildConfig(entry, pkgDir),
    configObjectFullPath: join(pkgDir, 'api-extractor.json'),
    packageJsonFullPath: join(pkgDir, 'package.json'),
    tsdocConfigFile,
  });
  // Always invoke with localBuild=true so warnings (e.g. `ae-undocumented`)
  // don't fail CI; the driver decides what's fatal: errors and report drift.
  const result: ExtractorResult = Extractor.invoke(cfg, {
    localBuild: true,
    showVerboseMessages: false,
  });
  if (result.errorCount > 0) {
    console.error(`× ${label}: ${result.errorCount} error(s)`);
    failures += 1;
  } else if (result.apiReportChanged && !isUpdate) {
    console.error(
      `× ${label}: API report changed. Run \`pnpm api:update\` and commit.`,
    );
    failures += 1;
  } else {
    console.log(`✓ ${label}`);
  }
}

if (failures > 0) process.exit(1);

function assertEntriesCoverPublicPackages(): void {
  const packagesDir = join(repoRoot, 'packages');
  const declared = new Set(entries.map((e) => e.pkg));
  const missing: string[] = [];
  for (const dirent of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const pkgJsonPath = join(packagesDir, dirent.name, 'package.json');
    let pkg: { private?: boolean };
    try {
      pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
    } catch {
      continue;
    }
    if (pkg.private === true) continue;
    if (!declared.has(dirent.name)) missing.push(dirent.name);
  }
  if (missing.length > 0) {
    console.error(
      `× public packages missing from entries[] in scripts/checkApi.mts: ${missing.join(', ')}`,
    );
    process.exit(1);
  }
}
