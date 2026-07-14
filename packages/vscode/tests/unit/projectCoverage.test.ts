import { describe, expect, it } from '@rstest/core';
import { computeCoveredConfigs } from '../../src/projectCoverage';

// Roots are absolute in practice; use POSIX-looking paths for readability.
const p = (
  configFilePath: string,
  root: string,
  childProjectRoots: string[] = [],
) => ({ configFilePath, root, childProjectRoots });

describe('computeCoveredConfigs', () => {
  it('suppresses child configs aggregated by a root config', () => {
    // Mirrors rslib: a root config aggregates packages/* and tests, while each
    // package also has its own standalone config.
    const covered = computeCoveredConfigs([
      p('/repo/rstest.config.ts', '/repo', [
        '/repo/packages/core',
        '/repo/packages/dts',
        '/repo/tests',
      ]),
      p('/repo/tests/rstest.config.ts', '/repo/tests', ['/repo/tests']),
      p('/repo/packages/core/rstest.config.ts', '/repo/packages/core'),
      p('/repo/packages/dts/rstest.config.ts', '/repo/packages/dts'),
    ]);

    // Only the aggregator root survives.
    expect([...covered].sort()).toEqual([
      '/repo/packages/core/rstest.config.ts',
      '/repo/packages/dts/rstest.config.ts',
      '/repo/tests/rstest.config.ts',
    ]);
  });

  it('does not suppress a config via its own projects (self-coverage)', () => {
    // A lone aggregator whose inline children share its own root must not hide
    // itself.
    const covered = computeCoveredConfigs([
      p('/repo/tests/rstest.config.ts', '/repo/tests', [
        '/repo/tests',
        '/repo/tests',
      ]),
    ]);
    expect(covered.size).toBe(0);
  });

  it('keeps independent per-package configs when there is no aggregator', () => {
    const covered = computeCoveredConfigs([
      p('/repo/packages/a/rstest.config.ts', '/repo/packages/a'),
      p('/repo/packages/b/rstest.config.ts', '/repo/packages/b'),
    ]);
    expect(covered.size).toBe(0);
  });

  it('matches a root reported with a trailing separator', () => {
    const covered = computeCoveredConfigs([
      p('/repo/rstest.config.ts', '/repo', ['/repo/packages/core']),
      // core's own root arrives with a trailing separator.
      p('/repo/packages/core/rstest.config.ts', '/repo/packages/core/'),
    ]);
    expect([...covered]).toEqual(['/repo/packages/core/rstest.config.ts']);
  });
});
