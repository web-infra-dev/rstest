import type {
  CoverageMap,
  CoverageMapData,
  FileCoverage,
  FileCoverageData,
  Range,
} from 'istanbul-lib-coverage';
import istanbulLibCoverage from 'istanbul-lib-coverage';

const { createCoverageMap } = istanbulLibCoverage;

type BranchHits = Record<string, number[]>;
type IstanbulFileCoverageData = FileCoverageData & {
  all?: boolean;
  bT?: BranchHits;
  hash?: string;
};
type FileCoverageInput = FileCoverage | FileCoverageData;

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
