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
import { Parser } from 'acorn';
import type { FileCoverageData } from 'istanbul-lib-coverage';
import { CoverageProvider } from '../src/provider';
import { convertV8CoverageWithAst } from '../src/v8AstConverter';

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
  takeRawCoverage: () => Promise<unknown[]>;
};

function getProviderInternals(provider: CoverageProvider): ProviderInternals {
  // Access private helpers in tests to lock compatibility without exporting
  // test-only APIs from the package.
  return provider as unknown as ProviderInternals;
}

function parseModule(code: string) {
  return Parser.parse(code, {
    ecmaVersion: 'latest',
    locations: true,
    ranges: true,
    sourceType: 'module',
  });
}

describe('coverage-v8 provider', () => {
  it('reads charset base64 inline source maps in the AST converter', async () => {
    const root = join(tmpdir(), 'rstest-coverage-v8-inline-map-charset');
    const generatedFile = join(root, 'dist', 'bundle.js');
    const originalFile = join(root, 'src', 'original.ts');
    const sourceMap = {
      version: 3,
      file: generatedFile,
      sources: ['../src/original.ts'],
      sourcesContent: ['const value = 1;'],
      names: [],
      mappings: 'AAAA',
    };
    const code = `const value = 1;\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(
      JSON.stringify(sourceMap),
    ).toString('base64')}`;
    const ast = parseModule(code);

    const coverage = await convertV8CoverageWithAst({
      ast,
      cacheKey: `${generatedFile}:inline-charset`,
      code,
      coverage: {
        url: pathToFileURL(generatedFile).href,
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }],
          },
        ],
      },
    });

    expect(Object.keys(coverage)).toEqual([originalFile]);
  });

  it('reads non-base64 inline data source maps in the AST converter', async () => {
    const root = join(tmpdir(), 'rstest-coverage-v8-inline-map-data-url');
    const generatedFile = join(root, 'dist', 'bundle.js');
    const originalFile = join(root, 'src', 'original.ts');
    const sourceMap = {
      version: 3,
      file: generatedFile,
      sources: ['../src/original.ts'],
      sourcesContent: ['const value = 1;'],
      names: [],
      mappings: 'AAAA',
    };
    const code = `const value = 1;\n//# sourceMappingURL=data:application/json;charset=UTF-8,${encodeURIComponent(
      JSON.stringify(sourceMap),
    )}`;
    const ast = parseModule(code);

    const coverage = await convertV8CoverageWithAst({
      ast,
      cacheKey: `${generatedFile}:inline-data-url`,
      code,
      coverage: {
        url: pathToFileURL(generatedFile).href,
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }],
          },
        ],
      },
    });

    expect(Object.keys(coverage)).toEqual([originalFile]);
  });

  it('uses the final inline sourceMappingURL comment in the AST converter', async () => {
    const root = join(tmpdir(), 'rstest-coverage-v8-final-inline-map');
    const generatedFile = join(root, 'dist', 'bundle.js');
    const staleOriginalFile = join(root, 'src', 'stale.ts');
    const finalOriginalFile = join(root, 'src', 'final.ts');
    const createSourceMap = (source: string) => ({
      version: 3,
      file: generatedFile,
      sources: [source],
      sourcesContent: ['const value = 1;'],
      names: [],
      mappings: 'AAAA',
    });
    const staleMap = Buffer.from(
      JSON.stringify(createSourceMap('../src/stale.ts')),
    ).toString('base64');
    const finalMap = Buffer.from(
      JSON.stringify(createSourceMap('../src/final.ts')),
    ).toString('base64');
    const code = [
      'const value = 1;',
      `//# sourceMappingURL=data:application/json;base64,${staleMap}`,
      `//# sourceMappingURL=data:application/json;base64,${finalMap}`,
    ].join('\n');
    const ast = parseModule(code);

    const coverage = await convertV8CoverageWithAst({
      ast,
      cacheKey: `${generatedFile}:final-inline-map`,
      code,
      coverage: {
        url: pathToFileURL(generatedFile).href,
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }],
          },
        ],
      },
    });

    expect(Object.keys(coverage)).toEqual([finalOriginalFile]);
    expect(Object.keys(coverage)).not.toEqual([staleOriginalFile]);
  });

  it('uses value offsets for object property function coverage', async () => {
    const file = join(tmpdir(), 'rstest-coverage-v8-property-function.js');
    const code = 'const o = { a: function () {} };\no.a;';
    const functionStart = code.indexOf('function');
    const functionEnd = functionStart + 'function () {}'.length;
    const ast = parseModule(code);

    const coverage = await convertV8CoverageWithAst({
      ast,
      cacheKey: `${file}:property-function`,
      code,
      coverage: {
        url: pathToFileURL(file).href,
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }],
          },
          {
            functionName: 'a',
            isBlockCoverage: true,
            ranges: [
              { startOffset: functionStart, endOffset: functionEnd, count: 0 },
            ],
          },
        ],
      },
    });

    const fileCoverage = coverage[file]!;
    expect(fileCoverage.fnMap[0]?.name).toBe('a');
    expect(fileCoverage.f).toEqual({ 0: 0 });
  });

  it('preserves non-file source map URLs as coverage filenames', async () => {
    const generatedFile = join(
      tmpdir(),
      'rstest-coverage-v8-webpack-source.js',
    );
    const sourceUrl = 'webpack://rstest/src/original.ts';
    const code = 'const value = 1;';
    const ast = parseModule(code);

    const coverage = await convertV8CoverageWithAst({
      ast,
      cacheKey: `${generatedFile}:webpack-source`,
      code,
      coverage: {
        url: pathToFileURL(generatedFile).href,
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }],
          },
        ],
      },
      sourceMap: {
        version: 3,
        sources: [sourceUrl],
        sourcesContent: [code],
        names: [],
        mappings: 'AAAA',
      },
    });

    expect(Object.keys(coverage)).toEqual([sourceUrl]);
  });

  it('resolves external source map sources relative to the map file', async () => {
    const root = join(tmpdir(), 'rstest-coverage-v8-nested-external-map');
    const generatedFile = join(root, 'dist', 'bundle.js');
    const originalFile = join(root, 'src', 'original.ts');
    const code = 'const value = 1;';
    const ast = parseModule(code);

    const coverage = await convertV8CoverageWithAst({
      ast,
      cacheKey: `${generatedFile}:nested-external-map`,
      code,
      coverage: {
        url: pathToFileURL(generatedFile).href,
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }],
          },
        ],
      },
      sourceMap: {
        version: 3,
        sources: ['../../src/original.ts'],
        sourcesContent: [code],
        names: [],
        mappings: 'AAAA',
      },
      sourceMapUrl: join(root, 'dist', 'maps', 'bundle.js.map'),
    });

    expect(Object.keys(coverage)).toEqual([originalFile]);
  });

  it('does not remap unmapped wrapper statements to the next source', async () => {
    const root = join(tmpdir(), 'rstest-coverage-v8-unmapped-wrapper');
    const generatedFile = join(root, 'dist', 'bundle.js');
    const originalFile = join(root, 'src', 'original.ts');
    const code = '(function(){})();\nconst value = 1;';
    const ast = parseModule(code);

    const coverage = await convertV8CoverageWithAst({
      ast,
      cacheKey: `${generatedFile}:unmapped-wrapper`,
      code,
      coverage: {
        url: pathToFileURL(generatedFile).href,
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }],
          },
        ],
      },
      sourceMap: {
        version: 3,
        sources: ['../src/original.ts'],
        sourcesContent: ['const value = 1;'],
        names: [],
        mappings: ';AAAA',
      },
    });

    expect(Object.keys(coverage)).toEqual([originalFile]);
    expect(coverage[originalFile]?.statementMap).toEqual({
      0: {
        start: { line: 1, column: 0 },
        end: { line: 1, column: Number.POSITIVE_INFINITY },
      },
    });
  });

  it('preserves the else branch when ignoring the if branch', async () => {
    const file = join(tmpdir(), 'rstest-coverage-v8-ignore-if-else.js');
    const code = `const flag = true;
/* istanbul ignore if */ if (flag) { foo(); } else { bar(); }`;
    const ast = parseModule(code);

    const coverage = await convertV8CoverageWithAst({
      ast,
      cacheKey: `${file}:ignore-if-else`,
      code,
      coverage: {
        url: pathToFileURL(file).href,
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }],
          },
        ],
      },
    });

    expect(coverage[file]?.branchMap[0]?.locations).toHaveLength(1);
    expect(coverage[file]?.b[0]).toEqual([1]);
  });

  it('does not add an implicit else branch when ignoring an absent else branch', async () => {
    const file = join(tmpdir(), 'rstest-coverage-v8-ignore-implicit-else.js');
    const code = `const flag = true;
/* istanbul ignore else */ if (flag) { foo(); }`;
    const ast = parseModule(code);

    const coverage = await convertV8CoverageWithAst({
      ast,
      cacheKey: `${file}:ignore-implicit-else`,
      code,
      coverage: {
        url: pathToFileURL(file).href,
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }],
          },
        ],
      },
    });

    expect(coverage[file]?.branchMap[0]?.locations).toHaveLength(1);
    expect(coverage[file]?.b[0]).toEqual([1]);
  });

  it('gives implicit else branches numeric locations', async () => {
    const file = join(tmpdir(), 'rstest-coverage-v8-implicit-else-location.js');
    const code = 'if (flag) { foo(); }';
    const ast = parseModule(code);

    const coverage = await convertV8CoverageWithAst({
      ast,
      cacheKey: `${file}:implicit-else-location`,
      code,
      coverage: {
        url: pathToFileURL(file).href,
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }],
          },
        ],
      },
    });

    expect(coverage[file]?.branchMap[0]?.locations).toEqual([
      {
        start: { line: 1, column: 0 },
        end: { line: 1, column: Number.POSITIVE_INFINITY },
      },
      {
        start: { line: 1, column: 0 },
        end: { line: 1, column: Number.POSITIVE_INFINITY },
      },
    ]);
  });

  it('honors ignore-next comments before ternary separators', async () => {
    const file = join(tmpdir(), 'rstest-coverage-v8-ignore-ternary-next.js');
    const code = "const os = flag ? 'OSX' /* v8 ignore next */ : 'Windows';";
    const ast = parseModule(code);

    const coverage = await convertV8CoverageWithAst({
      ast,
      cacheKey: `${file}:ignore-ternary-next`,
      code,
      coverage: {
        url: pathToFileURL(file).href,
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }],
          },
        ],
      },
    });

    expect(coverage[file]?.branchMap[0]?.locations).toHaveLength(1);
    expect(coverage[file]?.b[0]).toEqual([1]);
  });

  it('invalidates prepared AST coverage when an external source map changes', async () => {
    const root = join(tmpdir(), 'rstest-coverage-v8-external-map-cache');
    const generatedFile = join(root, 'dist', 'bundle.js');
    const firstOriginalFile = join(root, 'src', 'first.ts');
    const secondOriginalFile = join(root, 'src', 'second.ts');
    const code = 'const value = 1;\n//# sourceMappingURL=bundle.js.map';
    const provider = new CoverageProvider(createOptions(), root);
    const providerInternals = getProviderInternals(provider);
    const entry = {
      url: pathToFileURL(generatedFile).href,
      scriptId: '1',
      functions: [
        {
          functionName: '',
          isBlockCoverage: true,
          ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }],
        },
      ],
    };

    const createSourceMap = (source: string) =>
      JSON.stringify({
        version: 3,
        file: generatedFile,
        sources: [source],
        sourcesContent: ['const value = 1;'],
        names: [],
        mappings: 'AAAA',
      });

    try {
      mkdirSync(join(root, 'dist'), { recursive: true });
      writeFileSync(generatedFile, code);
      writeFileSync(
        join(root, 'dist', 'bundle.js.map'),
        createSourceMap('../src/first.ts'),
      );

      const firstCoverage = await providerInternals.convertWithAst(
        generatedFile,
        entry,
      );

      writeFileSync(
        join(root, 'dist', 'bundle.js.map'),
        createSourceMap('../src/second.ts'),
      );

      const secondCoverage = await providerInternals.convertWithAst(
        generatedFile,
        entry,
      );

      expect(Object.keys(firstCoverage)).toEqual([firstOriginalFile]);
      expect(Object.keys(secondCoverage)).toEqual([secondOriginalFile]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses the final sourceMappingURL comment for external source maps', async () => {
    const root = join(tmpdir(), 'rstest-coverage-v8-final-source-map-url');
    const generatedFile = join(root, 'dist', 'bundle.js');
    const staleOriginalFile = join(root, 'src', 'stale.ts');
    const finalOriginalFile = join(root, 'src', 'final.ts');
    const code = [
      'const value = 1;',
      '//# sourceMappingURL=stale.js.map',
      '//# sourceMappingURL=final.js.map',
    ].join('\n');
    const provider = new CoverageProvider(createOptions(), root);
    const providerInternals = getProviderInternals(provider);
    const entry = {
      url: pathToFileURL(generatedFile).href,
      scriptId: '1',
      functions: [
        {
          functionName: '',
          isBlockCoverage: true,
          ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }],
        },
      ],
    };

    const createSourceMap = (source: string) =>
      JSON.stringify({
        version: 3,
        file: generatedFile,
        sources: [source],
        sourcesContent: ['const value = 1;'],
        names: [],
        mappings: 'AAAA',
      });

    try {
      mkdirSync(join(root, 'dist'), { recursive: true });
      writeFileSync(generatedFile, code);
      writeFileSync(
        join(root, 'dist', 'stale.js.map'),
        createSourceMap('../src/stale.ts'),
      );
      writeFileSync(
        join(root, 'dist', 'final.js.map'),
        createSourceMap('../src/final.ts'),
      );

      const coverage = await providerInternals.convertWithAst(
        generatedFile,
        entry,
      );

      expect(Object.keys(coverage)).toEqual([finalOriginalFile]);
      expect(Object.keys(coverage)).not.toEqual([staleOriginalFile]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps branch counts aligned when an arm has no source mapping', async () => {
    const root = join(tmpdir(), 'rstest-coverage-v8-branch-range-alignment');
    const generatedFile = join(root, 'dist', 'bundle.js');
    const originalFile = join(root, 'src', 'original.ts');
    const code = `if (flag)
{
  foo();
}
else { bar(); }`;
    const ast = parseModule(code);
    const consequentStart = code.indexOf('{');
    const consequentEnd = code.indexOf('}') + 1;
    const alternateStart = code.lastIndexOf('{');
    const alternateEnd = code.lastIndexOf('}') + 1;

    const coverage = await convertV8CoverageWithAst({
      ast,
      cacheKey: `${generatedFile}:branch-range-alignment`,
      code,
      coverage: {
        url: pathToFileURL(generatedFile).href,
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [
              { startOffset: 0, endOffset: code.length, count: 1 },
              {
                startOffset: consequentStart,
                endOffset: consequentEnd,
                count: 0,
              },
              {
                startOffset: alternateStart,
                endOffset: alternateEnd,
                count: 1,
              },
            ],
          },
        ],
      },
      sourceMap: {
        version: 3,
        sources: ['../src/original.ts'],
        sourcesContent: ['if (flag) { bar(); }'],
        names: [],
        mappings: [[[0, 0, 0, 0]], [], [], [], [[0, 0, 0, 1]]],
      },
    });

    expect(coverage[originalFile]?.branchMap[0]?.locations).toHaveLength(1);
    expect(coverage[originalFile]?.b[0]).toEqual([1]);
  });

  it('treats V8 end offsets as exclusive for adjacent ranges', async () => {
    const file = join(tmpdir(), 'rstest-coverage-v8-exclusive-end-offset.js');
    const code = 'function f(){}g();';
    const ast = parseModule(code);
    const functionEnd = code.indexOf('g();');

    const coverage = await convertV8CoverageWithAst({
      ast,
      cacheKey: `${file}:exclusive-end-offset`,
      code,
      coverage: {
        url: pathToFileURL(file).href,
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }],
          },
          {
            functionName: 'f',
            isBlockCoverage: true,
            ranges: [{ startOffset: 0, endOffset: functionEnd, count: 0 }],
          },
        ],
      },
    });

    expect(coverage[file]?.s).toEqual({ 0: 1 });
  });

  it('accumulates duplicate statement hits from the same source mapping', async () => {
    const root = join(tmpdir(), 'rstest-coverage-v8-duplicate-statement-hit');
    const generatedFile = join(root, 'dist', 'bundle.js');
    const originalFile = join(root, 'src', 'original.ts');
    const code = 'foo();\nbar();';
    const ast = parseModule(code);
    const secondStatementStart = code.indexOf('bar();');

    const coverage = await convertV8CoverageWithAst({
      ast,
      cacheKey: `${generatedFile}:duplicate-statement-hit`,
      code,
      coverage: {
        url: pathToFileURL(generatedFile).href,
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [
              { startOffset: 0, endOffset: code.length, count: 1 },
              {
                startOffset: secondStatementStart,
                endOffset: code.length,
                count: 0,
              },
            ],
          },
        ],
      },
      sourceMap: {
        version: 3,
        sources: ['../src/original.ts'],
        sourcesContent: ['call();'],
        names: [],
        mappings: [[[0, 0, 0, 0]], [[0, 0, 0, 0]]],
      },
    });

    expect(coverage[originalFile]?.statementMap).toEqual({
      0: {
        start: { line: 1, column: 0 },
        end: { line: 1, column: Number.POSITIVE_INFINITY },
      },
    });
    expect(coverage[originalFile]?.s).toEqual({ 0: 1 });
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

  it('filters raw coverage entries before source lookup and conversion', async () => {
    const root = join(tmpdir(), 'rstest-coverage-v8-raw-filter');
    const includedFile = join(root, 'src', 'included.js');
    const nodeModuleFile = join(root, 'node_modules', 'dep', 'index.js');
    const provider = new CoverageProvider(createOptions(), root);
    const providerInternals = getProviderInternals(provider);
    const fileCoverage = {
      path: includedFile,
      statementMap: {},
      fnMap: {},
      branchMap: {},
      s: {},
      f: {},
      b: {},
    } satisfies FileCoverageData;
    const convertedFiles: string[] = [];

    Object.defineProperty(providerInternals, 'takeRawCoverage', {
      configurable: true,
      value: async () => [
        {
          url: pathToFileURL(nodeModuleFile).href,
          filePath: nodeModuleFile,
          scriptId: '1',
          functions: [],
        },
        {
          url: pathToFileURL(includedFile).href,
          filePath: includedFile,
          scriptId: '2',
          functions: [],
        },
      ],
    });
    Object.defineProperty(provider, 'session', {
      configurable: true,
      value: {},
    });
    Object.defineProperty(providerInternals, 'convertWithAst', {
      configurable: true,
      value: async (filePath: string) => {
        convertedFiles.push(filePath);
        return { [includedFile]: fileCoverage };
      },
    });

    try {
      const coverageMap = await provider.collect({
        assetFiles: {
          [includedFile]: 'value();',
          [nodeModuleFile]: 'dep();',
        },
        sourceMaps: {},
      });

      expect(convertedFiles).toEqual([includedFile]);
      expect(coverageMap?.files()).toEqual([includedFile]);
    } finally {
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
