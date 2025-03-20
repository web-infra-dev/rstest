import { runInPool } from '../pool';
import type { RstestContext } from '../types';
import { color, getTestEntries, logger } from '../utils';
import { createRsbuildServer } from './rsbuild';
import { printSummaryLog } from './summary';

export async function runTests(
  context: RstestContext,
  fileFilters: string[],
): Promise<void> {
  const { include, exclude, root, name } = context.normalizedConfig;

  const sourceEntries = await getTestEntries({
    include,
    exclude,
    root,
    fileFilters,
  });

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

  const { close, entries, assetFiles } = await createRsbuildServer(
    name,
    sourceEntries,
  );

  const { results, testResults } = await runInPool({
    entries,
    assetFiles,
    context,
  });

  if (results.some((r) => r.status === 'fail')) {
    process.exitCode = 1;
  }

  printSummaryLog(results, testResults);

  await close();
}
