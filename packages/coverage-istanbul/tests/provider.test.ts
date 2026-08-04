import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NormalizedCoverageOptions } from '@rstest/core';
import type { CoverageMap } from 'istanbul-lib-coverage';
import { CoverageProvider } from '../src/provider';

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

    // `collect` only runs inside a test worker, so its exit code is the pool's
    // own signal, never the embedding host's.
    expect(provider.collect()).toBeNull();
    expect(loggedError).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('reports an untested file it cannot instrument without touching the exit code', async () => {
    const provider = new CoverageProvider(createOptions());
    const errors: string[] = [];
    let failures = 0;

    console.error = (...args: unknown[]) => {
      errors.push(args.join(' '));
    };

    const coverage = await provider.generateCoverageForUntestedFiles({
      environmentName: 'test',
      files: [join(tmpdir(), 'rstest-coverage-istanbul-missing', 'missing.ts')],
      onFailure: () => {
        failures++;
      },
    });

    expect(coverage).toEqual([]);
    expect(errors[0]).toContain('Can not generate coverage for untested file');
    // Core's untested-file backfill runs in the host process, so the failure is
    // a reported value and the host's exit code stays its own.
    expect(failures).toBe(1);
    expect(process.exitCode).toBe(originalExitCode);
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
