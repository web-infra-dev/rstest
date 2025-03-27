import { runInPool } from '../pool';
import type { RstestContext } from '../types';
import { color, getSetupFiles, getTestEntries, logger } from '../utils';
import { createRsbuildServer, prepareRsbuild } from './rsbuild';

export async function runTests(
  context: RstestContext,
  fileFilters: string[],
): Promise<void> {
  const start = Date.now();

  const {
    normalizedConfig: { include, exclude, root, name, setupFiles: setups },
    rootPath,
    reporters,
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

  const rsbuildInstance = await prepareRsbuild(name, sourceEntries, setupFiles);

  const prepareEnd = Date.now();

  const buildStart = Date.now();
  const { close, entries, assetFiles, setupEntries } =
    await createRsbuildServer({
      name,
      sourceEntries,
      setupFiles,
      rsbuildInstance,
    });

  const buildEnd = Date.now();

  const testStart = Date.now();
  const { results, testResults } = await runInPool({
    entries,
    assetFiles,
    setupEntries,
    context,
  });
  const testEnd = Date.now();

  const duration = {
    prepareTime: prepareEnd - start,
    totalTime: testEnd - start,
    buildTime: buildEnd - buildStart,
    testTime: testEnd - testStart,
  };

  if (results.some((r) => r.status === 'fail')) {
    process.exitCode = 1;
  }

  for (const reporter of reporters) {
    reporter.onTestRunEnd?.(results, testResults, duration);
  }

  await close();
}
