import type { RsbuildPlugin } from '@rsbuild/core';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import {
  resolveRelatedTestFiles,
  resolveStatsPathCandidate,
} from '../../src/core/execution/related';
import { Rstest } from '../../src/core/rstest';
import type { RstestExposeAPI } from '../../src/types';
import { filterFiles } from '../../src/utils/testFiles';

// Run `fn` with a stubbed `process.platform` so both platform branches of
// `filterFiles` execute deterministically on any host — CI runs unit tests on
// Linux only (enforced by the `rstest/os-agnostic-tests` rule in
// rstack.config.mts). The original value is captured via its property
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
        ['"/repo/tests/index.test.ts"'],
        '/repo',
      ),
    ).toEqual(['/repo/tests/index.test.ts']);
  });

  it('keeps exact matching case-sensitive outside Windows', () => {
    withPlatform('linux', () => {
      expect(
        filterFiles(
          ['/repo/tests/Foo.test.ts', '/repo/tests/foo.test.ts'],
          ['"/repo/tests/Foo.test.ts"'],
          '/repo',
        ),
      ).toEqual(['/repo/tests/Foo.test.ts']);
    });
  });

  it('matches exact paths case-insensitively on Windows', () => {
    withPlatform('win32', () => {
      expect(
        filterFiles(
          ['/repo/tests/Foo.test.ts', '/repo/tests/foo.test.ts'],
          ['"/repo/tests/Foo.test.ts"'],
          '/repo',
        ),
      ).toEqual(['/repo/tests/Foo.test.ts', '/repo/tests/foo.test.ts']);
    });
  });
});

describe('resolveRelatedTestFiles empty project pruning', () => {
  const createContext = (
    root: string,
    projects: Array<{
      name: string;
      include: string[];
      plugins?: RsbuildPlugin[];
    }>,
  ) =>
    new Rstest(
      {
        cwd: root,
        command: 'run',
        embedded: true,
        projects: projects.map((config) => ({ config: { root, ...config } })),
      },
      { root },
    );

  it('compiles only non-empty and hook-revealed projects, and none when all stay empty', async () => {
    const tempRoot = realpathSync(
      mkdtempSync(join(tmpdir(), 'rstest-related-prune-')),
    );
    try {
      writeFileSync(join(tempRoot, 'dep.ts'), 'export const value = 1;\n');
      writeFileSync(
        join(tempRoot, 'active.test.ts'),
        "import { value } from './dep';\nexport const res = value;\n",
      );
      writeFileSync(
        join(tempRoot, 'revealed.test.ts'),
        "import { value } from './dep';\nexport const res = value;\n",
      );

      let compilerNames: string[] = [];
      const recordCompilers: RsbuildPlugin = {
        name: 'record-compilers',
        setup(api) {
          api.onBeforeCreateCompiler(({ bundlerConfigs }) => {
            compilerNames = bundlerConfigs
              .map((c) => c.name)
              .filter((n): n is string => Boolean(n))
              .sort();
          });
        },
      };
      const revealPlugin: RsbuildPlugin = {
        name: 'reveal-tests',
        setup(api) {
          api
            .useExposed<RstestExposeAPI>('rstest')
            ?.modifyRstestConfig((cfg) => {
              cfg.include = ['revealed.test.ts'];
            });
        },
      };

      const matched = await resolveRelatedTestFiles(
        createContext(tempRoot, [
          {
            name: 'active',
            include: ['active.test.ts'],
            plugins: [recordCompilers],
          },
          { name: 'empty-plain', include: ['missing-a/**/*.test.ts'] },
          {
            name: 'empty-plugin',
            include: ['missing-b/**/*.test.ts'],
            plugins: [{ name: 'noop', setup() {} }],
          },
          {
            name: 'revealed',
            include: ['missing-c/**/*.test.ts'],
            plugins: [revealPlugin],
          },
        ]),
        { sourceFilters: ['dep.ts'] },
      );

      expect(matched).toEqual([
        join(tempRoot, 'active.test.ts'),
        join(tempRoot, 'revealed.test.ts'),
      ]);
      expect(compilerNames).toEqual(['active', 'revealed']);

      let allEmptyCompilers = 0;
      const allEmpty = await resolveRelatedTestFiles(
        createContext(tempRoot, [
          { name: 'empty-plain', include: ['missing-a/**/*.test.ts'] },
          {
            name: 'empty-plugin',
            include: ['missing-b/**/*.test.ts'],
            plugins: [
              {
                name: 'count',
                setup(api) {
                  api.onBeforeCreateCompiler(() => {
                    allEmptyCompilers += 1;
                  });
                },
              },
            ],
          },
        ]),
        { sourceFilters: ['dep.ts'] },
      );

      expect(allEmpty).toEqual([]);
      expect(allEmptyCompilers).toBe(0);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
