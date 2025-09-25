import { normalize } from 'pathe';
import { glob, isDynamicPattern } from 'tinyglobby';
import type { TestFileResult } from '../types';
import type {
  CoverageMap,
  CoverageOptions,
  CoverageProvider,
} from '../types/coverage';
import { logger } from '../utils';

const getIncludedFiles = async (
  coverage: CoverageOptions,
  rootPath: string,
): Promise<string[]> => {
  // fix issue with glob not working correctly when exclude path was not in the cwd
  const ignoredPatterns = coverage.exclude?.filter(
    (item) =>
      isDynamicPattern(item) ||
      item.startsWith(rootPath) ||
      item.startsWith('./'),
  );
  const allFiles = await glob(coverage.include!, {
    cwd: rootPath,
    absolute: true,
    onlyFiles: true,
    ignore: ignoredPatterns,
    dot: true,
    expandDirectories: false,
  });

  // 'a.ts' should match 'src/a.ts'
  if (ignoredPatterns?.length !== coverage.exclude?.length) {
    const excludes = coverage.exclude!.filter(
      (item) =>
        !isDynamicPattern(item) &&
        !item.startsWith(rootPath) &&
        !item.startsWith('./'),
    );
    return allFiles.filter((file) => {
      return !excludes.some((exclude) => file.includes(exclude));
    });
  }

  return allFiles;
};

export async function generateCoverage(
  coverage: CoverageOptions,
  rootPath: string,
  results: TestFileResult[],
  coverageProvider: CoverageProvider,
): Promise<void> {
  try {
    const finalCoverageMap = coverageProvider.createCoverageMap();

    // Merge coverage data from all test files
    for (const result of results) {
      if (result.coverage) {
        finalCoverageMap.merge(result.coverage);
      }
    }

    if (coverage.include?.length) {
      const allFiles = await getIncludedFiles(coverage, rootPath);

      // should be better to filter files before swc coverage is processed
      finalCoverageMap.filter((file) => allFiles.includes(normalize(file)));

      const coveredFiles = finalCoverageMap.files();

      const uncoveredFiles = allFiles.filter(
        (file) => !coveredFiles.includes(normalize(file)),
      );

      if (uncoveredFiles.length) {
        await generateCoverageForUntestedFiles(
          uncoveredFiles,
          finalCoverageMap,
          coverageProvider,
        );
      }
    }

    // Generate coverage reports
    await coverageProvider.generateReports(finalCoverageMap, coverage);

    if (coverage.thresholds) {
      const { checkThresholds } = await import('../coverage/checkThresholds');
      const thresholdResult = checkThresholds({
        coverageMap: finalCoverageMap,
        coverageProvider,
        rootPath,
        thresholds: coverage.thresholds,
      });
      if (!thresholdResult.success) {
        logger.log('');
        logger.log(thresholdResult.message);
        process.exitCode = 1;
      }
    }
  } catch (error) {
    logger.error('Failed to generate coverage reports:', error);
  }
}

async function generateCoverageForUntestedFiles(
  uncoveredFiles: string[],
  coverageMap: CoverageMap,
  coverageProvider: CoverageProvider,
): Promise<void> {
  logger.debug('Generating coverage for untested files...');

  if (!coverageProvider.generateCoverageForUntestedFiles) {
    logger.warn(
      'Current coverage provider does not support generating coverage for untested files.',
    );
    return;
  }

  const coverages =
    await coverageProvider.generateCoverageForUntestedFiles(uncoveredFiles);

  coverages.forEach((coverageData) => {
    coverageMap.addFileCoverage(coverageData);
  });
}
