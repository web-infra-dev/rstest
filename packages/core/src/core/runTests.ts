import istanbulLibCoverage from 'istanbul-lib-coverage';
import { createCoverageProvider } from '../coverage';
import { createPool } from '../pool';
import type { RstestContext } from '../types';
import { color, getSetupFiles, getTestEntries, logger } from '../utils';
import { createRsbuildServer, prepareRsbuild } from './rsbuild';

const { createCoverageMap } = istanbulLibCoverage;
export async function runTests(
  context: RstestContext,
  fileFilters: string[],
): Promise<void> {
  const {
    normalizedConfig: {
      include,
      exclude,
      root,
      name,
      setupFiles: setups,
      includeSource,
    },
    rootPath,
    reporters,
    snapshotManager,
    command,
  } = context;

  const globTestSourceEntries = async (): Promise<Record<string, string>> => {
    const entries = await getTestEntries({
      include,
      exclude,
      includeSource,
      root,
      fileFilters,
    });

    if (!Object.keys(entries).length) {
      logger.log(color.red('No test files found.'));
      logger.log('');
      if (fileFilters.length) {
        logger.log(color.gray('filter: '), fileFilters.join(color.gray(', ')));
      }
      logger.log(color.gray('include:'), include.join(color.gray(', ')));
      logger.log(color.gray('exclude:'), exclude.join(color.gray(', ')));
      logger.log('');
    }

    return entries;
  };

  const setupFiles = getSetupFiles(setups, rootPath);

  const rsbuildInstance = await prepareRsbuild(
    context,
    globTestSourceEntries,
    setupFiles,
  );

  const getRsbuildStats = await createRsbuildServer({
    name,
    normalizedConfig: context.normalizedConfig,
    // TODO: Try not to call globTestSourceEntries again.
    globTestSourceEntries,
    setupFiles,
    rsbuildInstance,
    rootPath,
  });

  const run = async () => {
    const {
      entries,
      setupEntries,
      assetFiles,
      sourceMaps,
      getSourcemap,
      close,
      buildTime,
    } = await getRsbuildStats();
    const testStart = Date.now();

    // Initialize coverage collector
    const coverageProvider = createCoverageProvider(
      context.normalizedConfig.coverage || {},
    );

    const pool = await createPool({
      entries,
      sourceMaps,
      setupEntries,
      assetFiles,
      context,
    });

    const { results, testResults } = await pool.runTests();

    const testTime = Date.now() - testStart;

    const duration = {
      totalTime: testTime + buildTime,
      buildTime,
      testTime,
    };

    // Generate coverage reports after all tests complete
    if (coverageProvider) {
      try {
        // Collect coverage data from all test results

        const finalCoverageMap = createCoverageMap();

        // Merge coverage data from all test files
        for (const result of results) {
          if ((result as any).coverage) {
            finalCoverageMap.merge((result as any).coverage);
          }
        }

        // Generate coverage reports
        await coverageProvider.generateReports(
          finalCoverageMap,
          context.normalizedConfig.coverage!,
        );

        // Cleanup
        coverageProvider.cleanup();
      } catch (error) {
        logger.error('Failed to generate coverage reports:', error);
      }
    }

    if (results.some((r) => r.status === 'fail')) {
      process.exitCode = 1;
    }

    for (const reporter of reporters) {
      await reporter.onTestRunEnd?.({
        results,
        testResults,
        snapshotSummary: snapshotManager.summary,
        duration,
        getSourcemap,
      });
    }

    return async () => {
      await close();
      await pool.close();
    };
  };

  if (command === 'watch') {
    rsbuildInstance.onDevCompileDone(async () => {
      await run();
    });
  } else {
    const close = await run();
    await close();
  }
}
