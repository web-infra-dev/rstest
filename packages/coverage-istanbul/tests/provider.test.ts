import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NormalizedCoverageOptions } from '@rstest/core';
import type { CoverageMap } from 'istanbul-lib-coverage';
import istanbulCoverage from 'istanbul-lib-coverage';
import { CoverageProvider } from '../src/provider';
import { createFileCoverage } from './fixtures';

const createOptions = (
  overrides: Partial<NormalizedCoverageOptions> = {},
): NormalizedCoverageOptions => ({
  enabled: true,
  exclude: [],
  provider: 'istanbul',
  reporters: [],
  reportsDirectory: 'coverage',
  clean: true,
  reportOnFailure: false,
  allowExternal: false,
  ...overrides,
});

describe('coverage-istanbul provider', () => {
  // Typed as optional so the `delete` below stays legal (the src-side
  // `declare global var __coverage__: any` is non-optional).
  const globalWithCoverage = globalThis as { __coverage__?: unknown };
  const originalCoverage = globalWithCoverage.__coverage__;
  const originalExitCode = process.exitCode;
  const originalError = console.error;

  afterEach(() => {
    globalWithCoverage.__coverage__ = originalCoverage;
    process.exitCode = originalExitCode;
    console.error = originalError;
  });

  it('returns null without touching the exit code when there is no coverage data', () => {
    delete globalWithCoverage.__coverage__;
    const provider = new CoverageProvider(createOptions());

    expect(provider.collect()).toBeNull();
    expect(process.exitCode).toBe(originalExitCode);
  });

  it('folds full then packed JSON payloads like native CoverageMap.merge', async () => {
    const provider = new CoverageProvider(createOptions());
    const map = provider.createCoverageMap();
    const oracle = istanbulCoverage.createCoverageMap();
    const queryCoverage = async (query: unknown) =>
      provider.queryCoverage(map, query);
    for (let index = 0; index < 3; index++) {
      const file = createFileCoverage('/project/shared.js');
      file.s[0] = index + 1;
      file.f[0] = 2 ** 32 + index;
      file.b[0]![1] = index * 13;
      file.bT = { 0: [index + 17, index * 7] };
      globalWithCoverage.__coverage__ = { [file.path]: file };
      oracle.merge({ [file.path]: structuredClone(file) });
      const raw = await provider.collectRaw({ queryCoverage });
      expect(raw?.full.length).toBe(index === 0 ? 1 : 0);
      expect(raw?.packed.length).toBe(index === 0 ? 0 : 1);
      provider.mergeRawCoverage(map, JSON.parse(JSON.stringify(raw)));
    }
    expect(JSON.stringify(map)).toBe(JSON.stringify(oracle));
  });

  it('keeps files without a hash full even when the host claims to know them', async () => {
    const provider = new CoverageProvider(createOptions());
    const file = createFileCoverage('/project/shared.js');
    delete file.hash;
    globalWithCoverage.__coverage__ = { [file.path]: file };
    const raw = await provider.collectRaw({
      queryCoverage: async () => [file.path],
    });
    expect(raw).toEqual({ full: [file], packed: [] });
  });

  it('folds packed coverage after another project unions the live entry', async () => {
    const provider = new CoverageProvider(createOptions());
    const map = provider.createCoverageMap();
    const oracle = istanbulCoverage.createCoverageMap();
    const path = '/project/shared.js';
    const first = createFileCoverage(path);
    const other = createFileCoverage(path);
    other.hash = 'other';
    other.statementMap[0] = {
      start: { line: 2, column: 0 },
      end: { line: 2, column: 10 },
    };
    other.s[0] = 7;
    const later = createFileCoverage(path);
    later.s[0] = 11;
    later.f[0] = 13;
    later.b[0] = [17, 19];
    for (const file of [first, other, later]) {
      oracle.merge({ [path]: structuredClone(file) });
    }

    provider.mergeRawCoverage(map, { full: [first], packed: [] });
    globalWithCoverage.__coverage__ = { [path]: later };
    const raw = await provider.collectRaw({
      queryCoverage: async (query) => provider.queryCoverage(map, query),
    });
    expect(raw?.full).toEqual([]);
    expect(raw?.packed).toHaveLength(1);
    provider.mergeRawCoverage(map, { full: [other], packed: [] });
    provider.mergeRawCoverage(map, raw);

    // Native Istanbul retains a stale hash after union; our accumulator drops it.
    Reflect.deleteProperty(oracle.fileCoverageFor(path).data, 'hash');
    expect(map.toJSON()).toEqual(oracle.toJSON());
    expect(provider.queryCoverage(map, { [path]: 'same' })).toEqual([path]);
    expect(provider.queryCoverage(map, { [path]: 'other' })).toEqual([path]);
    expect(
      provider.queryCoverage(provider.createCoverageMap(), { [path]: 'same' }),
    ).toEqual([]);
  });

  it('sends all files full when the coverage query throws', async () => {
    const provider = new CoverageProvider(createOptions());
    const file = createFileCoverage('/project/shared.js');
    globalWithCoverage.__coverage__ = { [file.path]: file };
    expect(
      await provider.collectRaw({
        queryCoverage: async () => {
          throw new Error('offline');
        },
      }),
    ).toEqual({ full: [file], packed: [] });
  });

  it('lets older cores fall back to collect by omitting resolveRawCoverage', () => {
    const provider = new CoverageProvider(createOptions());
    expect('resolveRawCoverage' in provider).toBe(false);
  });

  it('marks the run as failed when collection throws (parity with the v8 provider)', () => {
    globalWithCoverage.__coverage__ = {};
    const provider = new CoverageProvider(createOptions());

    // Force the merge step to fail so the catch branch runs.
    provider.createCoverageMap = (): CoverageMap =>
      ({
        merge() {
          throw new Error('boom');
        },
      }) as unknown as CoverageMap;

    let loggedError = false;
    console.error = () => {
      loggedError = true;
    };

    expect(provider.collect()).toBeNull();
    expect(loggedError).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('loads custom coverage reporters from relative config paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rstest-coverage-reporter-'));
    const outputFile = join(root, 'custom-reporter-output.json');

    try {
      writeFileSync(
        join(root, 'custom-coverage-reporter.mjs'),
        `import fs from 'node:fs';

export default class CustomCoverageReporter {
  constructor(options = {}) {
    this.options = options;
  }

  execute() {
    fs.writeFileSync(this.options.outputFile, JSON.stringify({ ok: true }));
  }
}
`,
      );

      const provider = new CoverageProvider(
        createOptions({
          reporters: [['./custom-coverage-reporter.mjs', { outputFile }]],
          reportsDirectory: join(root, 'coverage'),
        }),
        root,
      );

      await provider.generateReports(provider.createCoverageMap());

      expect(existsSync(outputFile)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
