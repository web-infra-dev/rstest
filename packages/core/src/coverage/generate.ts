import { glob } from 'tinyglobby';
import type { TestFileResult } from '../types';
import type {
  CoverageMap,
  CoverageOptions,
  CoverageProvider,
} from '../types/coverage';
import { logger } from '../utils';

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
      const allFiles = await glob(coverage.include, {
        cwd: rootPath,
        absolute: true,
        ignore: coverage.exclude,
        dot: true,
        expandDirectories: false,
      });

      // should be better to filter files before swc coverage is processed
      finalCoverageMap.filter((file) => {
        return allFiles.includes(file);
      });

      const coveredFiles = finalCoverageMap.files();

      const uncoveredFiles = allFiles.filter(
        (file) => !coveredFiles.includes(file),
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
      const thresholdResult = checkThresholds(
        finalCoverageMap,
        coverage.thresholds,
      );
      if (!thresholdResult.success) {
        process.exitCode = 1;
        logger.log('');
        logger.log(thresholdResult.message);
      }
    }

    // Cleanup
    coverageProvider.cleanup();
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

  const coverages =
    await coverageProvider.generateCoverageForUntestedFiles(uncoveredFiles);

  coverages.forEach((coverageData) => {
    coverageMap.addFileCoverage(coverageData);
  });
}
