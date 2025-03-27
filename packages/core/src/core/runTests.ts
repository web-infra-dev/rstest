import { runInPool } from '../pool';
import type { RstestContext } from '../types';
import { color, getSetupFiles, getTestEntries, logger } from '../utils';
import { createRsbuildServer } from './rsbuild';
import { printSummaryLog } from './summary';

export async function runTests(
  context: RstestContext,
  fileFilters: string[],
): Promise<void> {
  const start = Date.now();

  const {
    normalizedConfig: { include, exclude, root, name, setupFiles: setups },
    rootPath,
  } = context;

  const sourceEntries = await getTestEntries({
    include,
    exclude,
    root,
    fileFilters,
  });

  const setupFiles = getSetupFiles(setups, rootPath);

  if (!Object.keys(sourceEntries).length) {
    logger.log(color.red('No test files found.'));
    logger.log('');
    if (fileFilters.length) {
      logger.log(color.gray('filter: '), fileFilters.join(color.gray(', ')));
    }
    logger.log(color.gray('include:'), include.join(color.gray(', ')));
    logger.log(color.gray('exclude:'), exclude.join(color.gray(', ')));
    logger.log('');
    return;
  }

  const buildStart = Date.now();
  const { close, entries, assetFiles, setupEntries } =
    await createRsbuildServer(name, sourceEntries, setupFiles);

  const buildEnd = Date.now();

  const testStart = Date.now();
  const { results, testResults } = await runInPool({
    entries,
    assetFiles,
    setupEntries,
    context,
  });
  const testEnd = Date.now();

  if (results.some((r) => r.status === 'fail')) {
    process.exitCode = 1;
  }

  printSummaryLog(results, testResults, {
    totalTime: Date.now() - start,
    buildTime: buildEnd - buildStart,
    testTime: testEnd - testStart,
  });

  await close();
}
