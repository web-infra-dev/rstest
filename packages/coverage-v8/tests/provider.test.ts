import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import type { NormalizedCoverageOptions } from '@rstest/core';
import type { FileCoverageData } from 'istanbul-lib-coverage';
import { CoverageProvider } from '../src/provider';

const createOptions = (
  overrides: Partial<NormalizedCoverageOptions> = {},
): NormalizedCoverageOptions => ({
  enabled: true,
  exclude: [],
  provider: 'v8',
  reporters: [],
  reportsDirectory: 'coverage',
  clean: true,
  reportOnFailure: false,
  allowExternal: false,
  ...overrides,
});

type ProviderInternals = CoverageProvider & {
  findInDict: (
    dict: Record<string, string> | undefined,
    filePath: string,
  ) => string | undefined;
  convertWithAst: (
    filePath: string,
    entry: {
      url: string;
      scriptId: string;
      functions: [];
    },
    options?: {
      assetFiles?: Record<string, string>;
      sourceMaps?: Record<string, string>;
      outputModule?: boolean;
    },
  ) => Promise<Record<string, FileCoverageData>>;
};

function getProviderInternals(provider: CoverageProvider): ProviderInternals {
  // Access private helpers in tests to lock compatibility without exporting
  // test-only APIs from the package.
  return provider as unknown as ProviderInternals;
}

describe('coverage-v8 provider', () => {
  it('finds dictionary entries through normalized path variants', () => {
    const provider = getProviderInternals(
      new CoverageProvider(createOptions()),
    );
    const dict = {
      'src\\index.ts': 'slash-normalized',
      '/Project/src/Case.ts': 'case-insensitive',
      '/tmp/project/src/private.ts': 'private-prefix',
    };

    expect(provider.findInDict(dict, 'src/index.ts')).toBe('slash-normalized');
    expect(provider.findInDict(dict, '/project/src/case.ts')).toBe(
      'case-insensitive',
    );
    expect(
      provider.findInDict(dict, '/private/tmp/project/src/private.ts'),
    ).toBe('private-prefix');
  });

  it('skips excluded no-sourcemap files before reading or converting them', async () => {
    const root = join(tmpdir(), 'rstest-coverage-v8-early-filter');
    const file = join(root, 'excluded.js');
    const provider = new CoverageProvider(
      createOptions({
        exclude: ['excluded.js'],
      }),
      root,
    );
    const originalError = console.error;
    const originalExitCode = process.exitCode;
    let hasError = false;

    Object.defineProperty(provider, 'session', {
      configurable: true,
      value: {
        post: async (method: string) => {
          if (method === 'Profiler.takePreciseCoverage') {
            return {
              result: [
                {
                  url: pathToFileURL(file).href,
                  scriptId: '1',
                  functions: [],
                },
              ],
            };
          }

          return {};
        },
      },
    });

    console.error = () => {
      hasError = true;
    };

    try {
      mkdirSync(root, { recursive: true });
      rmSync(file, { force: true });

      const coverageMap = await provider.collect({
        sourceMaps: {},
      });

      expect(coverageMap?.files()).toEqual([]);
      expect(hasError).toBe(false);
      expect(process.exitCode).toBe(originalExitCode);
    } finally {
      console.error = originalError;
      process.exitCode = originalExitCode;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps excluded asset files with inline source maps for remapping', async () => {
    const root = join(tmpdir(), 'rstest-coverage-v8-inline-asset-map');
    const file = join(root, 'dist', 'bundle.js');
    const originalFile = join(root, 'src', 'original.ts');
    const provider = new CoverageProvider(
      createOptions({
        include: ['src/**/*.ts'],
        exclude: ['dist/**'],
      }),
      root,
    );
    const providerInternals = getProviderInternals(provider);
    const fileCoverage = {
      path: originalFile,
      statementMap: {},
      fnMap: {},
      branchMap: {},
      s: {},
      f: {},
      b: {},
    } satisfies FileCoverageData;

    Object.defineProperty(provider, 'session', {
      configurable: true,
      value: {
        post: async (method: string) => {
          if (method === 'Profiler.takePreciseCoverage') {
            return {
              result: [
                {
                  url: pathToFileURL(file).href,
                  scriptId: '1',
                  functions: [],
                },
              ],
            };
          }

          return {};
        },
      },
    });
    Object.defineProperty(providerInternals, 'convertWithAst', {
      configurable: true,
      value: async () => ({
        [originalFile]: fileCoverage,
      }),
    });

    try {
      mkdirSync(root, { recursive: true });

      const coverageMap = await provider.collect({
        assetFiles: {
          [file]:
            'value();\n//# sourceMappingURL=data:application/json;charset=UTF-8,%7B%7D',
        },
        sourceMaps: {},
      });

      expect(coverageMap?.files()).toEqual([originalFile]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps excluded disk files with inline source maps for remapping', async () => {
    const root = join(tmpdir(), 'rstest-coverage-v8-inline-disk-map');
    const file = join(root, 'dist', 'bundle.js');
    const originalFile = join(root, 'src', 'original.ts');
    const provider = new CoverageProvider(
      createOptions({
        include: ['src/**/*.ts'],
        exclude: ['dist/**'],
      }),
      root,
    );
    const providerInternals = getProviderInternals(provider);
    const fileCoverage = {
      path: originalFile,
      statementMap: {},
      fnMap: {},
      branchMap: {},
      s: {},
      f: {},
      b: {},
    } satisfies FileCoverageData;

    Object.defineProperty(provider, 'session', {
      configurable: true,
      value: {
        post: async (method: string) => {
          if (method === 'Profiler.takePreciseCoverage') {
            return {
              result: [
                {
                  url: pathToFileURL(file).href,
                  scriptId: '1',
                  functions: [],
                },
              ],
            };
          }

          return {};
        },
      },
    });
    Object.defineProperty(providerInternals, 'convertWithAst', {
      configurable: true,
      value: async () => ({
        [originalFile]: fileCoverage,
      }),
    });

    try {
      mkdirSync(join(root, 'dist'), { recursive: true });
      writeFileSync(
        file,
        'value();\n//# sourceMappingURL=data:application/json,%7B%7D',
      );

      const coverageMap = await provider.collect({
        assetFiles: {},
        sourceMaps: {},
      });

      expect(coverageMap?.files()).toEqual([originalFile]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
