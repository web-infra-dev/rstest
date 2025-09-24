import { relative } from 'pathe';
import picomatch from 'picomatch';
import type {
  CoverageMap,
  CoverageProvider,
  CoverageSummary,
  CoverageSummaryTotals,
  CoverageThreshold,
  CoverageThresholds,
} from '../types/coverage';
import { color } from '../utils';

const THRESHOLD_KEYS = [
  'lines',
  'functions',
  'statements',
  'branches',
] as const;

export function checkThresholds({
  coverageMap,
  thresholds,
  coverageProvider,
  rootPath,
}: {
  coverageMap: CoverageMap;
  thresholds: CoverageThresholds;
  coverageProvider: CoverageProvider;
  rootPath: string;
}): { success: boolean; message: string } {
  if (!thresholds) {
    return { success: true, message: '' };
  }
  const failedThresholds: string[] = [];

  const allFiles = coverageMap.files();

  const thresholdGroup: (CoverageThreshold & {
    name: string;
    coverageMap: CoverageMap;
    perFile?: boolean;
  })[] = [
    {
      statements: thresholds.statements,
      functions: thresholds.functions,
      branches: thresholds.branches,
      lines: thresholds.lines,
      name: 'global',
      coverageMap,
      perFile: false,
    },
  ];

  for (const key of Object.keys(thresholds)) {
    if (
      THRESHOLD_KEYS.includes(key as keyof CoverageThresholds) ||
      typeof thresholds[key as keyof CoverageThresholds] !== 'object'
    ) {
      continue;
    }

    const globCoverageMap = coverageProvider.createCoverageMap();

    const matcher = picomatch(key);
    const matchedFiles = allFiles.filter((file) =>
      matcher(relative(rootPath, file)),
    );

    if (!matchedFiles.length) {
      failedThresholds.push(
        `${color.red('Error')}: coverage data for "${key}" was not found`,
      );
      continue;
    }

    for (const file of matchedFiles) {
      const fileCoverage = coverageMap.fileCoverageFor(file);
      globCoverageMap.addFileCoverage(fileCoverage);
    }

    thresholdGroup.push({
      ...(<CoverageThreshold>thresholds[key as keyof CoverageThresholds]),
      name: key,
      coverageMap: globCoverageMap,
    });
  }

  const check = (
    name: keyof CoverageSummary,
    type: string,
    actual: CoverageSummaryTotals,
    expected: number,
    file?: string,
  ) => {
    let errorMsg = '';
    if (expected !== undefined) {
      // Thresholds specified as a negative number represent the maximum number of uncovered entities allowed.
      if (expected < 0) {
        const uncovered = actual.total - actual.covered;
        if (uncovered > -expected) {
          errorMsg += `uncovered ${name} ${color.red(`${uncovered}`)} exceeds maximum ${type === 'global' ? 'global' : `"${type}"`} threshold allowed ${color.yellow(`${-expected}`)}`;
        }
      }
      // Thresholds specified as a positive number are taken to be the minimum percentage required.
      else if (actual.pct < expected) {
        errorMsg += `coverage for ${name} ${color.red(`${actual.pct}%`)} does not meet ${type === 'global' ? 'global' : `"${type}"`} threshold ${color.yellow(`${expected}%`)}`;
      }
    }

    if (errorMsg) {
      failedThresholds.push(
        `${color.red('Error')}: ${file ? `${relative(rootPath, file)} ` : ''}${errorMsg}`,
      );
    }
  };

  thresholdGroup.forEach(({ name, coverageMap, ...thresholds }) => {
    const summaries = thresholds.perFile
      ? coverageMap.files().map((file) => ({
          file,
          summary: coverageMap.fileCoverageFor(file).toSummary(),
        }))
      : [{ file: '', summary: coverageMap.getCoverageSummary() }];

    for (const { summary, file } of summaries) {
      for (const key of THRESHOLD_KEYS) {
        if (thresholds[key] !== undefined) {
          check(key, name, summary[key], thresholds[key], file);
        }
      }
    }
  });

  return {
    success: failedThresholds.length === 0,
    message: failedThresholds.join('\n'),
  };
}
