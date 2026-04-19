import type FS from 'node:fs';
import { normalize } from 'pathe';
import { glob, isDynamicPattern } from 'tinyglobby';
import type { RstestContext } from '../types';
import type {
  CoverageMap,
  CoverageOptions,
  CoverageProvider,
} from '../types/coverage';
import { logger } from '../utils';

export const getIncludedFiles = async (
  coverage: CoverageOptions,
  rootPath: string,
  fs?: typeof FS,
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
    expandDirectories: false,
    fs,
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
  context: RstestContext,
  coverageMap: CoverageMap,
  coverageProvider: CoverageProvider,
): Promise<void> {
  const {
    rootPath,
    normalizedConfig: { coverage },
    projects,
  } = context;
  try {
    const finalCoverageMap = coverageMap;

    const distPathRoot = normalize(
      context.normalizedConfig.output?.distPath?.root || '',
    );
    finalCoverageMap.filter((filePath) => {
      const normalizedFile = normalize(filePath);
      if (distPathRoot && normalizedFile.startsWith(distPathRoot)) {
        return false;
      }
      if (
        normalizedFile.includes('webpack/runtime') ||
        normalizedFile.includes('rstest runtime')
      ) {
        return false;
      }
      if (!coverage.allowExternal) {
        return normalizedFile.startsWith(normalize(rootPath));
      }
      return true;
    });

    if (coverage.include?.length) {
      const coveredFilesSet = new Set(finalCoverageMap.files().map(normalize));

      let isTimeout = false;

      const timeoutId = setTimeout(() => {
        isTimeout = true;
        logger.info('Generating coverage for untested files...');
      }, 1000);

      // Process projects sequentially to limit peak memory — parallel
      // instrumentation of untested files across many projects can multiply
      // the resident set. Sequential processing lets each project's
      // intermediate data be GC'd before the next one starts.
      const allFiles: string[] = [];
      for (const p of projects) {
        const includedFiles = await getIncludedFiles(coverage, p.rootPath);
        allFiles.push(...includedFiles);

        const uncoveredFiles = includedFiles.filter(
          (file) => !coveredFilesSet.has(normalize(file)),
        );

        if (uncoveredFiles.length) {
          await generateCoverageForUntestedFiles(
            p.environmentName,
            uncoveredFiles,
            finalCoverageMap,
            coverageProvider,
          );
        }
      }

      clearTimeout(timeoutId);

      if (isTimeout) {
        logger.info('Coverage for untested files generated.');
      }

      // should be better to filter files before swc coverage is processed
      const allFilesSet = new Set(allFiles.map(normalize));
      finalCoverageMap.filter((file) => allFilesSet.has(normalize(file)));
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
        logger.stderr(thresholdResult.message);
        process.exitCode = 1;
      }
    }
  } catch (error) {
    logger.stderr('Failed to generate coverage reports:', error);
    process.exitCode = 1;
  }
}

async function generateCoverageForUntestedFiles(
  environmentName: string,
  uncoveredFiles: string[],
  coverageMap: CoverageMap,
  coverageProvider: CoverageProvider,
): Promise<void> {
  if (!coverageProvider.generateCoverageForUntestedFiles) {
    logger.warn(
      'Current coverage provider does not support generating coverage for untested files.',
    );
    return;
  }

  /**
   * Process untested files in batches to bound peak memory — each batch is
   * instrumented, merged into the coverage map, and then released before the
   * next batch starts. 25 is an empirical sweet-spot that keeps memory
   * reasonable without adding noticeable per-batch overhead.
   */
  const batchSize = 25;

  for (let index = 0; index < uncoveredFiles.length; index += batchSize) {
    const coverages = await coverageProvider.generateCoverageForUntestedFiles({
      environmentName,
      files: uncoveredFiles.slice(index, index + batchSize),
    });

    coverages.forEach((coverageData) => {
      coverageMap.addFileCoverage(coverageData);
    });
  }
}
