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

    expect(provider.collect()).toBeNull();
    expect(loggedError).toBe(true);
    expect(process.exitCode).toBe(1);
  });
});
