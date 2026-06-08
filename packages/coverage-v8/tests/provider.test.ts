import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

const createFileCoverage = (file: string) => ({
  path: file,
  statementMap: {
    0: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
  },
  fnMap: {
    0: {
      name: 'fn',
      decl: { start: { line: 1, column: 0 }, end: { line: 1, column: 2 } },
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
      line: 1,
    },
  },
  branchMap: {
    0: {
      type: 'if',
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
      locations: [
        { start: { line: 1, column: 0 }, end: { line: 1, column: 5 } },
        { start: { line: 1, column: 5 }, end: { line: 1, column: 10 } },
      ],
      line: 1,
    },
  },
  s: { 0: 1 },
  f: { 0: 2 },
  b: { 0: [3, 4] },
  hash: 'same',
});

const createUnhashedFileCoverage = (file: string) => {
  const coverage = createFileCoverage(file);
  return {
    ...coverage,
    hash: undefined,
  };
};

const trackNativeMerge = (
  coverageMap: ReturnType<CoverageProvider['createCoverageMap']>,
  file: string,
) => {
  const fileCoverage = coverageMap.fileCoverageFor(file);
  const merge = fileCoverage.merge.bind(fileCoverage);
  let mergeCalls = 0;

  fileCoverage.merge = (coverage) => {
    mergeCalls++;
    merge(coverage);
  };

  return () => mergeCalls;
};

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
  it('loads custom coverage reporters from relative config paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rstest-coverage-reporter-'));
    const outputFile = join(root, 'custom-reporter-output.json');

    try {
      writeFileSync(
        join(root, 'custom-coverage-reporter.cjs'),
        `const fs = require('node:fs');
module.exports = class CustomCoverageReporter {
  constructor(options = {}) {
    this.options = options;
  }

  execute() {
    fs.writeFileSync(this.options.outputFile, JSON.stringify({ ok: true }));
  }
};
`,
      );

      const provider = new CoverageProvider(
        createOptions({
          reporters: [['./custom-coverage-reporter.cjs', { outputFile }]],
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

  it('fast merges duplicate converted coverage shapes', () => {
    const file = '/project/src/index.ts';
    const provider = new CoverageProvider(createOptions());
    const coverageMap = provider.createCoverageMap();

    coverageMap.merge({
      [file]: createFileCoverage(file),
    });
    coverageMap.merge({
      [file]: {
        ...createFileCoverage(file),
        s: { 0: 5 },
        f: { 0: 7 },
        b: { 0: [11, 13] },
      },
    });

    expect(coverageMap.fileCoverageFor(file).toJSON()).toMatchObject({
      s: { 0: 6 },
      f: { 0: 9 },
      b: { 0: [14, 17] },
    });
  });

  it('falls back when converted coverage metadata differs', () => {
    const file = '/project/src/index.ts';
    const provider = new CoverageProvider(createOptions());
    const coverageMap = provider.createCoverageMap();

    coverageMap.merge({
      [file]: createUnhashedFileCoverage(file),
    });
    const getNativeMergeCalls = trackNativeMerge(coverageMap, file);

    coverageMap.merge({
      [file]: {
        ...createUnhashedFileCoverage(file),
        fnMap: {
          0: {
            ...createFileCoverage(file).fnMap[0],
            name: 'renamed',
          },
        },
        branchMap: {
          0: {
            ...createFileCoverage(file).branchMap[0],
            loc: {
              start: { line: 1, column: 0 },
              end: { line: 1, column: 11 },
            },
            line: 2,
          },
        },
        s: { 0: 5 },
        f: { 0: 7 },
        b: { 0: [11, 13] },
      },
    });

    expect(getNativeMergeCalls()).toBe(1);
    expect(coverageMap.fileCoverageFor(file).toJSON()).toMatchObject({
      s: { 0: 6 },
      f: { 0: 9 },
      b: { 0: [14, 17] },
      fnMap: {
        0: {
          name: 'fn',
        },
      },
      branchMap: {
        0: {
          line: 1,
        },
      },
    });
  });

  it('falls back when converted branch truthiness shape differs', () => {
    const file = '/project/src/index.ts';
    const provider = new CoverageProvider(createOptions());
    const coverageMap = provider.createCoverageMap();

    coverageMap.merge({
      [file]: createUnhashedFileCoverage(file),
    });
    const getNativeMergeCalls = trackNativeMerge(coverageMap, file);

    coverageMap.merge({
      [file]: {
        ...createUnhashedFileCoverage(file),
        bT: { 0: [17, 19] },
        s: { 0: 5 },
        f: { 0: 7 },
        b: { 0: [11, 13] },
      },
    });

    expect(getNativeMergeCalls()).toBe(1);
    const fileCoverage = coverageMap.fileCoverageFor(file).toJSON();
    expect(fileCoverage).not.toHaveProperty('bT');
    expect(fileCoverage).toMatchObject({
      s: { 0: 6 },
      f: { 0: 9 },
      b: { 0: [14, 17] },
    });
  });

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
