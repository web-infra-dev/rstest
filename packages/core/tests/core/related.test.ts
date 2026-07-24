import { resolveStatsPathCandidate } from '../../src/core/related';
import { filterFiles } from '../../src/utils/testFiles';

// Run `fn` with a stubbed `process.platform` so both platform branches of
// `filterFiles` execute deterministically on any host — CI runs unit tests on
// Linux only (enforced by the `rstest/os-agnostic-tests` rule in
// rslint.config.mts). The original value is captured via its property
// descriptor rather than a direct read, which is the stub/restore idiom that
// rule sanctions.
const withPlatform = (platform: NodeJS.Platform, fn: () => void) => {
  // `process.platform` always exists, so the descriptor lookup cannot miss.
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  // Spread the original descriptor so the stub keeps its configurable/writable
  // flags — the restore in `finally` then always succeeds regardless of how the
  // host defined `process.platform`.
  Object.defineProperty(process, 'platform', { ...original, value: platform });
  try {
    fn();
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
};

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

describe('filterFiles', () => {
  it('matches exact related test paths without prefix expansion', () => {
    expect(
      filterFiles(
        ['/repo/tests/index.test.ts', '/repo/tests/index.test.tsx'],
        ['/repo/tests/index.test.ts'],
        '/repo',
        'exact',
      ),
    ).toEqual(['/repo/tests/index.test.ts']);
  });

  it('keeps exact matching case-sensitive outside Windows', () => {
    withPlatform('linux', () => {
      expect(
        filterFiles(
          ['/repo/tests/Foo.test.ts', '/repo/tests/foo.test.ts'],
          ['/repo/tests/Foo.test.ts'],
          '/repo',
          'exact',
        ),
      ).toEqual(['/repo/tests/Foo.test.ts']);
    });
  });

  it('matches exact paths case-insensitively on Windows', () => {
    withPlatform('win32', () => {
      expect(
        filterFiles(
          ['/repo/tests/Foo.test.ts', '/repo/tests/foo.test.ts'],
          ['/repo/tests/Foo.test.ts'],
          '/repo',
          'exact',
        ),
      ).toEqual(['/repo/tests/Foo.test.ts', '/repo/tests/foo.test.ts']);
    });
  });
});
