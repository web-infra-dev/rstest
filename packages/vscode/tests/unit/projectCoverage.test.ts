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

  it('suppresses a nested intermediate config the root also aggregates', () => {
    // A root aggregates `sub` (which itself has `projects`) plus another
    // project. `initCli` flattens `sub` to its grandchildren, so `sub`'s own
    // root never appears in the root's list — but its grandchildren roots do.
    const covered = computeCoveredConfigs([
      p('/repo/rstest.config.ts', '/repo', [
        '/repo/sub/a',
        '/repo/sub/b',
        '/repo/other',
      ]),
      p('/repo/sub/rstest.config.ts', '/repo/sub', [
        '/repo/sub/a',
        '/repo/sub/b',
      ]),
    ]);
    expect([...covered]).toEqual(['/repo/sub/rstest.config.ts']);
  });

  it('suppresses a nested config even when the root aggregates only it', () => {
    // The root aggregates a single nested child, so both flatten to the same
    // grandchildren. The outer (ancestor-root) config wins.
    const covered = computeCoveredConfigs([
      p('/repo/rstest.config.ts', '/repo', ['/repo/sub/a', '/repo/sub/b']),
      p('/repo/sub/rstest.config.ts', '/repo/sub', [
        '/repo/sub/a',
        '/repo/sub/b',
      ]),
    ]);
    expect([...covered]).toEqual(['/repo/sub/rstest.config.ts']);
  });

  it('never lets two unrelated configs with identical roots hide each other', () => {
    const covered = computeCoveredConfigs([
      p('/repo/a/rstest.config.ts', '/repo/a', ['/shared/1', '/shared/2']),
      p('/repo/b/rstest.config.ts', '/repo/b', ['/shared/1', '/shared/2']),
    ]);
    expect(covered.size).toBe(0);
  });

  it('does not suppress standalone configs sharing a root the parent aggregates', () => {
    // `apps/web` has two standalone configs (e.g. different include/exclude).
    // The root aggregates `apps/web` via only one of them, so a root-only check
    // would hide the other config's tests. Neither may be suppressed.
    const covered = computeCoveredConfigs([
      p('/repo/rstest.config.ts', '/repo', ['/repo/apps/web']),
      p('/repo/apps/web/rstest.config.ts', '/repo/apps/web'),
      p('/repo/apps/web/rstest.e2e.config.ts', '/repo/apps/web'),
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
