import { runInPool } from '../pool';
import type { RstestContext } from '../types';
import { color, getTestEntries, logger } from '../utils';
import { createRsbuildServer } from './rsbuild';
import { printSummaryLog } from './summary';

export async function runTests(context: RstestContext): Promise<void> {
  const { include, exclude, root, name } = context.normalizedConfig;

  const sourceEntries = await getTestEntries({ include, exclude, root });

  if (!Object.keys(sourceEntries).length) {
    logger.log(color.red('No test files found.'));
    logger.log('');
    logger.log(color.gray('include:'), include.join(color.gray(', ')));
    logger.log(color.gray('exclude:'), exclude.join(color.gray(', ')));
    logger.log('');
    return;
  }

  const { close, readFile, entries } = await createRsbuildServer(
    name,
    sourceEntries,
  );

  const { results, testResults } = await runInPool({
    entries,
    readFile,
    context,
  });

  if (testResults.some((r) => r.status === 'fail')) {
    process.exitCode = 1;
  }

  printSummaryLog(results, testResults);

  await close();
}
