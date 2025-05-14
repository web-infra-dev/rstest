import { relative } from 'node:path';
import { createPool } from '../pool';
import type { RstestContext, Test } from '../types';
import {
  getSetupFiles,
  getTaskNameWithPrefix,
  getTestEntries,
  logger,
} from '../utils';
import { createRsbuildServer, prepareRsbuild } from './rsbuild';

export async function listTests(
  context: RstestContext,
  fileFilters: string[],
): Promise<void> {
  const {
    normalizedConfig: { include, exclude, root, name, setupFiles: setups },
    rootPath,
  } = context;

  const testEntries = await getTestEntries({
    include,
    exclude,
    root,
    fileFilters,
  });

  const globTestSourceEntries = async (): Promise<Record<string, string>> => {
    return testEntries;
  };

  const setupFiles = getSetupFiles(setups, rootPath);

  const rsbuildInstance = await prepareRsbuild(
    context,
    globTestSourceEntries,
    setupFiles,
  );

  const getRsbuildStats = await createRsbuildServer({
    name,
    globTestSourceEntries,
    setupFiles,
    rsbuildInstance,
    rootPath,
  });

  const { entries, setupEntries, assetFiles, sourceMaps, close } =
    await getRsbuildStats();

  const pool = await createPool({
    entries,
    sourceMaps,
    setupEntries,
    assetFiles,
    context,
  });

  const list = await pool.collectTests();

  const printTest = (test: Test) => {
    if (test.type === 'case') {
      logger.log(
        relative(rootPath, test.testPath),
        '>',
        getTaskNameWithPrefix(test),
      );
    } else {
      for (const child of test.tests) {
        printTest(child);
      }
    }
  };

  for (const files of list) {
    for (const test of files) {
      printTest(test);
    }
  }

  await close();

  await pool.close();
}
