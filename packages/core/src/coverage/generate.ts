import type FS from 'node:fs';
import { isAbsolute, normalize, relative } from 'pathe';
import picomatch from 'picomatch';
import { glob, isDynamicPattern } from 'tinyglobby';
import type { RstestContext } from '../types';
import type {
  CoverageMap,
  CoverageOptions,
  CoverageProvider,
} from '../types/coverage';
import { logger, type TraceSpan } from '../utils';

const traceNoop: TraceSpan = async (_name, _cat, fn) => fn();

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

    const matchesBareExclude = (file: string, exclude: string): boolean => {
      const normalizedFile = normalize(file);
      const normalizedExclude = normalize(exclude);

      return (
        normalizedFile === normalizedExclude ||
        normalizedFile.endsWith(`/${normalizedExclude}`) ||
        normalizedFile.includes(`/${normalizedExclude}/`)
      );
    };

    return allFiles.filter((file) => {
      return !excludes.some((exclude) => matchesBareExclude(file, exclude));
    });
  }

  return allFiles;
};

const normalizePathForSubPath = (filePath: string): string => {
  const normalized = normalize(filePath);

  if (normalized === '/' || /^[A-Za-z]:\/$/.test(normalized)) {
    return normalized;
  }

  return normalized.replace(/\/+$/, '');
};

const isSameOrSubPath = (filePath: string, parentPath: string): boolean => {
  const normalizedFilePath = normalizePathForSubPath(filePath);
  const normalizedParentPath = normalizePathForSubPath(parentPath);

  if (normalizedFilePath === normalizedParentPath) {
    return true;
  }

  if (normalizedParentPath.endsWith('/')) {
    return normalizedFilePath.startsWith(normalizedParentPath);
  }

  return normalizedFilePath.startsWith(`${normalizedParentPath}/`);
};

const filterExternalFiles = (
  files: string[],
  rootPath: string,
  allowExternal: boolean,
): string[] => {
  if (allowExternal) {
    return files;
  }

  return files.filter((file) => isSameOrSubPath(file, rootPath));
};

const getSetupCoverageExcludes = (context: RstestContext): Set<string> => {
  const setupFiles = context.projects.flatMap(
    ({ rootPath, normalizedConfig }) => {
      if (!normalizedConfig) {
        return [];
      }

      const files = [
        ...(normalizedConfig.setupFiles || []),
        ...(normalizedConfig.globalSetup || []),
      ];

      return files.map((filePath) =>
        isAbsolute(filePath) ? filePath : `${rootPath}/${filePath}`,
      );
    },
  );

  return new Set(setupFiles.map((filePath) => normalize(filePath)));
};

const shouldExcludeSetupCoverageFile = (
  filePath: string,
  rootPath: string,
  setupCoverageExcludes: Set<string>,
): boolean => {
  if (!setupCoverageExcludes.size) {
    return false;
  }

  const normalizedFilePath = normalize(filePath);

  if (setupCoverageExcludes.has(normalizedFilePath)) {
    return true;
  }

  const relativeFilePath = normalize(relative(rootPath, normalizedFilePath));
  if (relativeFilePath.startsWith('../')) {
    return false;
  }

  return Array.from(setupCoverageExcludes).some((setupFile) => {
    const relativeSetupPath = normalize(relative(rootPath, setupFile));
    if (relativeSetupPath.startsWith('../')) {
      return false;
    }
    return picomatch.isMatch(relativeFilePath, relativeSetupPath);
  });
};

const isRuntimeSentinelCoverageFile = (filePath: string): boolean =>
  filePath === 'rstest runtime' ||
  filePath === 'webpack/runtime' ||
  filePath.startsWith('webpack/runtime/');

export const filterChangedFiles = (
  files: string[],
  changedCoverageFilters: string[] | undefined,
  rootPath: string,
): string[] => {
  if (!changedCoverageFilters?.length) {
    return files;
  }

  const changedFilesSet = new Set<string>();
  for (const file of changedCoverageFilters) {
    changedFilesSet.add(normalize(file));
    changedFilesSet.add(normalize(relative(rootPath, file)));
  }

  return files.filter((file) => {
    const normalizedFile = normalize(file);
    return (
      changedFilesSet.has(normalizedFile) ||
      changedFilesSet.has(normalize(relative(rootPath, file)))
    );
  });
};

export async function generateCoverage(
  context: RstestContext,
  coverageMap: CoverageMap,
  coverageProvider: CoverageProvider,
  traceSpan: TraceSpan = traceNoop,
): Promise<void> {
  const {
    rootPath,
    normalizedConfig: { coverage },
    projects,
  } = context;
  try {
    const finalCoverageMap = coverageMap;

    await traceSpan(
      'coverage:filter-files',
      'coverage',
      () => {
        const rawDistPathRoot = context.normalizedConfig.output?.distPath?.root;
        const distPathRoot = rawDistPathRoot ? normalize(rawDistPathRoot) : '';
        const normalizedRootPath = normalize(rootPath);
        const setupCoverageExcludes = getSetupCoverageExcludes(context);
        const absDistPathRoot = distPathRoot
          ? normalize(
              isAbsolute(distPathRoot)
                ? distPathRoot
                : `${normalizedRootPath}/${distPathRoot}`,
            )
          : '';
        finalCoverageMap.filter((filePath) => {
          const normalizedFile = normalize(filePath);
          const fileRelativeToRoot = normalize(
            relative(normalizedRootPath, normalizedFile),
          );
          if (
            (distPathRoot &&
              isSameOrSubPath(fileRelativeToRoot, distPathRoot)) ||
            (absDistPathRoot &&
              isSameOrSubPath(normalizedFile, absDistPathRoot))
          ) {
            return false;
          }
          if (isRuntimeSentinelCoverageFile(normalizedFile)) {
            return false;
          }
          // Keep setupFiles/globalSetup out of the final report for every provider.
          // Istanbul already excludes them before instrumentation; V8 needs this
          // post-collection pruning so both providers converge on the same output.
          if (
            shouldExcludeSetupCoverageFile(
              normalizedFile,
              normalizedRootPath,
              setupCoverageExcludes,
            )
          ) {
            return false;
          }
          if (!coverage.allowExternal) {
            return isSameOrSubPath(normalizedFile, normalizedRootPath);
          }
          return true;
        });
      },
      { allowExternal: coverage.allowExternal },
    );

    if (coverage.include?.length) {
      const coveredFilesSet = await traceSpan(
        'coverage:collect-covered-files',
        'coverage',
        () => new Set(finalCoverageMap.files().map(normalize)),
      );

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
        const includedFiles = await traceSpan(
          'coverage:collect-included-files',
          'coverage',
          async () =>
            filterChangedFiles(
              filterExternalFiles(
                await getIncludedFiles(coverage, p.rootPath),
                p.rootPath,
                coverage.allowExternal,
              ),
              context.changedCoverageFilters,
              p.rootPath,
            ),
          {
            project: p.environmentName,
            changedOnly: Boolean(context.changedCoverageFilters?.length),
          },
        );
        allFiles.push(...includedFiles);

        const uncoveredFiles = includedFiles.filter(
          (file) => !coveredFilesSet.has(normalize(file)),
        );

        if (uncoveredFiles.length) {
          await traceSpan(
            'coverage:generate-untested-files',
            'coverage',
            () =>
              generateCoverageForUntestedFiles(
                p.environmentName,
                uncoveredFiles,
                finalCoverageMap,
                coverageProvider,
                traceSpan,
              ),
            {
              project: p.environmentName,
              fileCount: uncoveredFiles.length,
            },
          );
        }
      }

      clearTimeout(timeoutId);

      if (isTimeout) {
        logger.info('Coverage for untested files generated.');
      }

      // should be better to filter files before swc coverage is processed
      const allFilesSet = new Set(allFiles.map(normalize));
      await traceSpan(
        'coverage:filter-included-files',
        'coverage',
        () => {
          finalCoverageMap.filter((file) => allFilesSet.has(normalize(file)));
        },
        { fileCount: allFilesSet.size },
      );
    } else if (context.changedCoverageFilters?.length) {
      await traceSpan(
        'coverage:filter-changed-files',
        'coverage',
        () => {
          finalCoverageMap.filter(
            (file) =>
              filterChangedFiles(
                [file],
                context.changedCoverageFilters,
                rootPath,
              ).length > 0,
          );
        },
        { filterCount: context.changedCoverageFilters.length },
      );
    }

    // Generate coverage reports
    await traceSpan('coverage:generate-reports', 'coverage', () =>
      coverageProvider.generateReports(finalCoverageMap, coverage),
    );

    if (coverage.thresholds) {
      const { thresholds } = coverage;
      const thresholdResult = await traceSpan(
        'coverage:check-thresholds',
        'coverage',
        async () => {
          const { checkThresholds } =
            await import('../coverage/checkThresholds');
          return checkThresholds({
            coverageMap: finalCoverageMap,
            coverageProvider,
            rootPath,
            thresholds,
          });
        },
      );
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
  traceSpan: TraceSpan = traceNoop,
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
    const files = uncoveredFiles.slice(index, index + batchSize);
    const coverages = await traceSpan(
      'coverage:generate-untested-files-batch',
      'coverage',
      () =>
        coverageProvider.generateCoverageForUntestedFiles!({
          environmentName,
          files,
        }),
      {
        environmentName,
        batchIndex: Math.floor(index / batchSize),
        fileCount: files.length,
      },
    );

    coverages.forEach((coverageData) => {
      coverageMap.addFileCoverage(coverageData);
    });
  }
}
