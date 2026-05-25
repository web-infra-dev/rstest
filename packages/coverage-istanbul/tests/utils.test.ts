import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import istanbulCoverage from 'istanbul-lib-coverage';
import {
  createFastCoverageMap,
  getSourceMappingURL,
  transformCoverage,
} from '../src/utils';

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

describe('coverage istanbul utils', () => {
  it('fast merges coverage when instrumentation shape matches', () => {
    const file = '/project/src/index.ts';
    const coverageMap = createFastCoverageMap();

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

  it('uses native add for the first coverage map merge', () => {
    const file = '/project/src/index.ts';
    const coverageMap = createFastCoverageMap();
    const originalAddFileCoverage = coverageMap.addFileCoverage;
    let addFileCoverageCalls = 0;

    coverageMap.addFileCoverage = (coverage) => {
      addFileCoverageCalls++;
      originalAddFileCoverage(coverage);
    };

    coverageMap.merge({
      [file]: createFileCoverage(file),
    });

    expect(addFileCoverageCalls).toBe(0);
    expect(coverageMap.fileCoverageFor(file).toJSON()).toMatchObject({
      s: { 0: 1 },
      f: { 0: 2 },
      b: { 0: [3, 4] },
    });
  });

  it('falls back to istanbul merge when coverage shapes differ', () => {
    const file = '/project/src/index.ts';
    const coverageMap = createFastCoverageMap();

    coverageMap.merge({
      [file]: createFileCoverage(file),
    });
    coverageMap.merge({
      [file]: {
        ...createFileCoverage(file),
        statementMap: {
          0: { start: { line: 2, column: 0 }, end: { line: 2, column: 10 } },
        },
        s: { 0: 5 },
        hash: 'different',
      },
    });

    expect(coverageMap.fileCoverageFor(file).toJSON()).toMatchObject({
      statementMap: {
        0: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
        1: { start: { line: 2, column: 0 }, end: { line: 2, column: 10 } },
      },
      s: { 0: 1, 1: 5 },
    });
  });

  it('keeps istanbul all-file merge semantics', () => {
    const file = '/project/src/index.ts';
    const coverageMap = createFastCoverageMap();

    coverageMap.addFileCoverage({ ...createFileCoverage(file), all: true });
    coverageMap.addFileCoverage(createFileCoverage(file));

    const fileCoverage = coverageMap.fileCoverageFor(file).toJSON();
    expect(fileCoverage).not.toHaveProperty('all');
    expect(fileCoverage).toMatchObject({
      s: { 0: 1 },
      f: { 0: 2 },
      b: { 0: [3, 4] },
    });
  });

  it('extracts the last sourceMappingURL without splitting the whole file', () => {
    const code = [
      'const sourceMappingURL = "not a comment";',
      '//# sourceMappingURL=first.js.map',
      'console.log("hello");',
      '//# sourceMappingURL=second.js.map',
    ].join('\n');

    expect(getSourceMappingURL(code)).toBe('second.js.map');
  });

  it('returns undefined when sourceMappingURL only appears outside comments', () => {
    expect(getSourceMappingURL('const sourceMappingURL = "inline";')).toBe(
      undefined,
    );
  });

  it('does not reread files whose sourcemap cache entry is already undefined', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rstest-coverage-cache-'));
    const file = path.join(root, 'index.js');
    writeFileSync(file, 'export const value = 1;\n');

    const coverageMap = istanbulCoverage.createCoverageMap({
      [file]: {
        path: file,
        statementMap: {},
        fnMap: {},
        branchMap: {},
        s: {},
        f: {},
        b: {},
      },
    });
    const sourcemapUrlCache = new Map<string, string | undefined>([
      [file, undefined],
    ]);

    try {
      rmSync(file);
      await expect(
        transformCoverage(coverageMap, sourcemapUrlCache),
      ).resolves.toBe(coverageMap);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('retries sourcemap reads after filesystem errors', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rstest-coverage-retry-'));
    const file = path.join(root, 'index.js');

    const coverageMap = istanbulCoverage.createCoverageMap({
      [file]: {
        path: file,
        statementMap: {},
        fnMap: {},
        branchMap: {},
        s: {},
        f: {},
        b: {},
      },
    });
    const sourcemapUrlCache = new Map<string, string | undefined>();

    try {
      await expect(
        transformCoverage(coverageMap, sourcemapUrlCache),
      ).resolves.toBe(coverageMap);
      expect(sourcemapUrlCache.has(file)).toBe(false);

      writeFileSync(file, 'export const value = 1;\n');

      await expect(
        transformCoverage(coverageMap, sourcemapUrlCache),
      ).resolves.toBe(coverageMap);
      expect(sourcemapUrlCache.has(file)).toBe(true);
      expect(sourcemapUrlCache.get(file)).toBe(undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
