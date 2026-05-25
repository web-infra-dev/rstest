import { runInNewContext } from 'node:vm';
import type {
  CoverageMap,
  CoverageMapData,
  FileCoverage,
  FileCoverageData,
  Range,
} from 'istanbul-lib-coverage';
import istanbulLibCoverage from 'istanbul-lib-coverage';
import type { MapStore } from 'istanbul-lib-source-maps';

const SOURCE_MAP_SCAN_CONCURRENCY = 8;
const { createCoverageMap } = istanbulLibCoverage;

type BranchHits = Record<string, number[]>;
type IstanbulFileCoverageData = FileCoverageData & {
  all?: boolean;
  bT?: BranchHits;
  hash?: string;
};
type FileCoverageInput = FileCoverage | FileCoverageData;

// ATTENTION: when swc-plugin-coverage-instrument version changed, magic value should be updated too
// https://github.com/kwonoj/swc-plugin-coverage-instrument/blob/63e9d5e16dbe61073c62af4b7dfed3c1779cbafa/spec/util/constants.ts#L1-L2
const COVERAGE_MAGIC_KEY = '_coverageSchema';
const COVERAGE_MAGIC_VALUE = '11020577277169172593';

// generated code looks like this:

// var coverageData = { <--- find until open brace
//   all: false,
//   path: '',
//   statementMap: {},
//   fnMap: {},
//   branchMap: {},
//   s: {},
//   f: {},
//   b: {},
//   _coverageSchema: '11020577277169172593', <--- from here
//   hash: '',
// }; <--- and until close brace

export function readInitialCoverage(
  code: string,
): FileCoverageData | undefined {
  const magicValueIndex = code.indexOf(COVERAGE_MAGIC_VALUE);
  if (magicValueIndex === -1) throw new Error('cannot find magic value');

  let openBraceIndex = magicValueIndex;
  let remainOpenBraceCount = 1;
  while (remainOpenBraceCount > 0) {
    openBraceIndex--;
    if (openBraceIndex < 0) throw new Error('cannot find open brace');
    const char = code[openBraceIndex];
    if (char === '}') remainOpenBraceCount++;
    else if (char === '{') remainOpenBraceCount--;
  }

  let closeBraceIndex = magicValueIndex;
  let remainCloseBraceCount = 1;
  while (remainCloseBraceCount > 0) {
    closeBraceIndex++;
    if (closeBraceIndex >= code.length)
      throw new Error('cannot find close brace');
    const char = code[closeBraceIndex];
    if (char === '{') remainCloseBraceCount++;
    else if (char === '}') remainCloseBraceCount--;
  }

  const coverageDataStr = code.slice(openBraceIndex, closeBraceIndex + 1);
  const coverageData = runInNewContext(`Object(${coverageDataStr})`);
  if (coverageData?.[COVERAGE_MAGIC_KEY] !== COVERAGE_MAGIC_VALUE)
    throw new Error('invalid coverageData');

  return coverageData;
}

// https://github.com/webpack/webpack/blob/99c36fab8e8b21885f02cca76c253f51b97997eb/lib/util/extractSourceMap.js#L53

// Matches only the last occurrence of sourceMappingURL
const innerRegex = /\s*[#@]\s*sourceMappingURL\s*=\s*([^\s'"]*)\s*/;

const sourceMappingURLRegex = new RegExp(
  '(?:' +
    '/\\*' +
    '(?:\\s*\r?\n(?://)?)?' +
    `(?:${innerRegex.source})` +
    '\\s*' +
    '\\*/' +
    '|' +
    `//(?:${innerRegex.source})` +
    ')' +
    '\\s*',
);

/**
 * Extract source mapping URL from code comments
 * @param {string} code source code content
 * @returns {string | undefined} source mapping information
 */
export function getSourceMappingURL(code: string): string | undefined {
  let searchIndex = code.lastIndexOf('sourceMappingURL');

  while (searchIndex !== -1) {
    const lineStart = code.lastIndexOf('\n', searchIndex);
    const lineEnd = code.indexOf('\n', searchIndex);
    const line = code.slice(
      lineStart + 1,
      lineEnd === -1 ? code.length : lineEnd,
    );
    const match = line.match(sourceMappingURLRegex);

    if (match) {
      const sourceMappingURL = match[1] || match[2] || '';
      return sourceMappingURL ? decodeURI(sourceMappingURL) : undefined;
    }

    searchIndex = code.lastIndexOf('sourceMappingURL', lineStart - 1);
  }

  return undefined;
}

export function registerSourceMapURL(
  filename: string,
  code: string,
  sourcemapUrlCache: Map<string, string | undefined>,
): void {
  // process js/cjs/mjs file only
  if (!filename.endsWith('js')) return;

  const url = getSourceMappingURL(code);
  sourcemapUrlCache.set(filename, url);
}

const isCoverageMap = (
  coverage: CoverageMap | CoverageMapData,
): coverage is CoverageMap =>
  typeof (coverage as CoverageMap).files === 'function' && 'data' in coverage;

const getCoverageMapData = (
  coverage: CoverageMap | CoverageMapData,
): CoverageMapData => (isCoverageMap(coverage) ? coverage.data : coverage);

const getFileCoverageData = (
  coverage: FileCoverageInput,
): IstanbulFileCoverageData =>
  'data' in coverage
    ? (coverage.data as IstanbulFileCoverageData)
    : (coverage as IstanbulFileCoverageData);

const getFileCoveragePath = (coverage: FileCoverageInput): string =>
  coverage.path;

const hasSameKeys = <T>(
  a: Record<string, T>,
  b: Record<string, T>,
): boolean => {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) {
    return false;
  }

  return aKeys.every((key) => Object.hasOwn(b, key));
};

const hasSameBranchHitShape = (a: BranchHits, b: BranchHits): boolean => {
  if (!hasSameKeys(a, b)) {
    return false;
  }

  return Object.keys(a).every((key) => a[key]!.length === b[key]!.length);
};

const hasSameOptionalBranchHitShape = (
  a: BranchHits | undefined,
  b: BranchHits | undefined,
): boolean => {
  if (!a && !b) {
    return true;
  }

  if (!a || !b) {
    return false;
  }

  return hasSameBranchHitShape(a, b);
};

const isSameRange = (a: Range, b: Range): boolean =>
  a.start.line === b.start.line &&
  a.start.column === b.start.column &&
  a.end.line === b.end.line &&
  a.end.column === b.end.column;

const hasSameStatementMap = (
  a: FileCoverageData['statementMap'],
  b: FileCoverageData['statementMap'],
): boolean =>
  hasSameKeys(a, b) &&
  Object.keys(a).every((key) => isSameRange(a[key]!, b[key]!));

const hasSameFunctionMap = (
  a: FileCoverageData['fnMap'],
  b: FileCoverageData['fnMap'],
): boolean =>
  hasSameKeys(a, b) &&
  Object.keys(a).every((key) => {
    const aFunction = a[key]!;
    const bFunction = b[key]!;
    return (
      aFunction.name === bFunction.name &&
      aFunction.line === bFunction.line &&
      isSameRange(aFunction.decl, bFunction.decl) &&
      isSameRange(aFunction.loc, bFunction.loc)
    );
  });

const hasSameBranchMap = (
  a: FileCoverageData['branchMap'],
  b: FileCoverageData['branchMap'],
): boolean =>
  hasSameKeys(a, b) &&
  Object.keys(a).every((key) => {
    const aBranch = a[key]!;
    const bBranch = b[key]!;
    return (
      aBranch.type === bBranch.type &&
      aBranch.line === bBranch.line &&
      isSameRange(aBranch.loc, bBranch.loc) &&
      aBranch.locations.length === bBranch.locations.length &&
      aBranch.locations.every((loc, index) =>
        isSameRange(loc, bBranch.locations[index]!),
      )
    );
  });

const canFastMergeCoverage = (
  existing: IstanbulFileCoverageData,
  incoming: IstanbulFileCoverageData,
): boolean => {
  if (incoming.all === true) {
    return true;
  }

  if (existing.all === true) {
    return false;
  }

  if (!hasSameOptionalBranchHitShape(existing.bT, incoming.bT)) {
    return false;
  }

  if (existing.hash && incoming.hash) {
    return existing.hash === incoming.hash;
  }

  if (
    !hasSameKeys(existing.s, incoming.s) ||
    !hasSameKeys(existing.f, incoming.f) ||
    !hasSameBranchHitShape(existing.b, incoming.b)
  ) {
    return false;
  }

  return (
    hasSameStatementMap(existing.statementMap, incoming.statementMap) &&
    hasSameFunctionMap(existing.fnMap, incoming.fnMap) &&
    hasSameBranchMap(existing.branchMap, incoming.branchMap)
  );
};

const mergeNumberHits = (
  target: Record<string, number>,
  source: Record<string, number>,
): void => {
  for (const key of Object.keys(source)) {
    target[key] = target[key]! + source[key]!;
  }
};

const mergeBranchHits = (target: BranchHits, source: BranchHits): void => {
  for (const key of Object.keys(source)) {
    const targetBranches = target[key]!;
    const sourceBranches = source[key]!;
    for (let index = 0; index < sourceBranches.length; index++) {
      targetBranches[index] = targetBranches[index]! + sourceBranches[index]!;
    }
  }
};

const fastMergeFileCoverage = (
  existing: IstanbulFileCoverageData,
  incoming: IstanbulFileCoverageData,
): boolean => {
  if (!canFastMergeCoverage(existing, incoming)) {
    return false;
  }

  if (incoming.all === true) {
    return true;
  }

  mergeNumberHits(existing.s, incoming.s);
  mergeNumberHits(existing.f, incoming.f);
  mergeBranchHits(existing.b, incoming.b);

  if (existing.bT && incoming.bT) {
    mergeBranchHits(existing.bT, incoming.bT);
  }

  return true;
};

export function createFastCoverageMap(): CoverageMap {
  const coverageMap = createCoverageMap({});
  const addFileCoverage = coverageMap.addFileCoverage.bind(coverageMap);
  let hasMergedCoverage = false;

  coverageMap.addFileCoverage = (coverage: string | FileCoverageInput) => {
    if (typeof coverage === 'string') {
      addFileCoverage(coverage);
      return;
    }

    const existingCoverage = coverageMap.data[getFileCoveragePath(coverage)];

    if (
      existingCoverage &&
      fastMergeFileCoverage(
        getFileCoverageData(existingCoverage),
        getFileCoverageData(coverage),
      )
    ) {
      return;
    }

    addFileCoverage(coverage);
  };

  coverageMap.merge = (coverage: CoverageMap | CoverageMapData) => {
    if (!hasMergedCoverage) {
      for (const fileCoverage of Object.values(getCoverageMapData(coverage))) {
        addFileCoverage(fileCoverage);
      }
      hasMergedCoverage = true;
      return;
    }

    for (const fileCoverage of Object.values(getCoverageMapData(coverage))) {
      coverageMap.addFileCoverage(fileCoverage);
    }
  };

  return coverageMap;
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await mapper(items[currentIndex]!, currentIndex);
    }
  };

  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

export async function transformCoverage(
  coverageMap: CoverageMap,
  sourcemapUrlCache: Map<string, string | undefined>,
): Promise<CoverageMap> {
  const jsFiles = coverageMap
    .files()
    // process js/cjs/mjs file only
    .filter((filename) => filename.endsWith('js'));

  const uncachedFiles = jsFiles.filter(
    (filename) => !sourcemapUrlCache.has(filename),
  );

  if (uncachedFiles.length) {
    const { readFile } = await import('node:fs/promises');
    await mapWithConcurrency(
      uncachedFiles,
      SOURCE_MAP_SCAN_CONCURRENCY,
      async (filename) => {
        try {
          const content = await readFile(filename, 'utf8');
          sourcemapUrlCache.set(filename, getSourceMappingURL(content));
        } catch {
          // Do not cache failed reads. The file may be temporarily unavailable
          // during watch-mode rebuilds, so retry it on the next report.
        }
      },
    );
  }

  // Call createSourceMapStore as needed
  let store: MapStore | undefined;
  for (const filename of jsFiles) {
    const url = sourcemapUrlCache.get(filename);
    if (url) {
      if (!store) {
        const { createSourceMapStore } =
          await import('istanbul-lib-source-maps');
        store = createSourceMapStore();
      }
      store.registerURL(filename, url);
    }
  }
  if (store) return store.transformCoverage(coverageMap);

  return coverageMap;
}
