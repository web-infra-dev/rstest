import { createPool } from '../pool';
import type { RstestContext } from '../types';
import { color, getSetupFiles, getTestEntries, logger } from '../utils';
import { createRsbuildServer, prepareRsbuild } from './rsbuild';

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
      logger.log(color.green('  Waiting for file changes...'));
    });
  } else {
    const close = await run();
    await close();
  }
}
