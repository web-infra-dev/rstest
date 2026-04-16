import { resolveStatsPathCandidate } from '../../src/core/related';

describe('resolveStatsPathCandidate', () => {
  it('preserves POSIX absolute paths after stripping file protocol', () => {
    expect(
      resolveStatsPathCandidate({
        candidate: 'file:///home/app/src/index.ts',
        projectRoot: '/repo',
      }),
    ).toBe('/home/app/src/index.ts');
  });

  it('preserves Windows absolute paths after stripping file protocol', () => {
    expect(
      resolveStatsPathCandidate({
        candidate: 'file:///C:/repo/src/index.ts',
        projectRoot: '/repo',
      }),
    ).toBe('C:/repo/src/index.ts');
  });

  it('resolves relative stats paths against the project root', () => {
    expect(
      resolveStatsPathCandidate({
        candidate: './src/index.ts?query',
        projectRoot: '/repo',
      }),
    ).toBe('/repo/src/index.ts');
  });
});
